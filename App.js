import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useAudioRecorder, useAudioRecorderState, AudioModule, setAudioModeAsync } from 'expo-audio';
import { AttachmentState } from '@powersync/react-native';
import { PowerSyncContext, useQuery, useStatus } from '@powersync/react';
import { useCactusLM, useCactusSTT } from 'cactus-react-native';

import * as DocumentPicker from 'expo-document-picker';
import { File as ExpoFile } from 'expo-file-system';

import { AppEnv } from './src/config/env';
import { loadCredentials, saveCredentials, clearCredentials, loadModelPrefs, saveModelPrefs } from './src/config/credentials';
import { LLM_MODELS, EMBEDDING_MODELS, STT_MODELS, DEFAULT_LLM_MODEL, DEFAULT_STT_MODEL } from './src/config/models';
import { TABLES } from './src/powersync/schema';
import { system } from './src/powersync/system';
import { estimateCosts } from './src/utils/costModel';
import { parseEmbedding, cosineSimilarity, normalizeVector } from './src/utils/embeddings';
import { readFileContent, chunkText } from './src/utils/fileParser';
import { randomId } from './src/utils/randomId';

const SCREENS = {
  models: 'models',
  home: 'home',
  transcription: 'transcription',
  rag: 'rag',
  attachments: 'attachments',
  offline: 'offline'
};

const ATTACHMENT_STATE_LABELS = {
  [AttachmentState.QUEUED_SYNC]: 'Queued sync',
  [AttachmentState.QUEUED_UPLOAD]: 'Queued upload',
  [AttachmentState.QUEUED_DOWNLOAD]: 'Queued download',
  [AttachmentState.SYNCED]: 'Synced',
  [AttachmentState.ARCHIVED]: 'Archived'
};

const toIsoNow = () => new Date().toISOString();

export default function App() {
  const [initializing, setInitializing] = React.useState(true);
  const [initError, setInitError] = React.useState('');
  const [session, setSession] = React.useState(null);
  const [credentialsReady, setCredentialsReady] = React.useState(false);
  const [showSettings, setShowSettings] = React.useState(false);
  const [skippedSettings, setSkippedSettings] = React.useState(false);

  const bootstrap = React.useCallback(async (env) => {
    try {
      // If a specific env was provided (new credentials), reconfigure the system.
      if (env) {
        await system.reconfigure(env);
      } else {
        await system.init();
      }

      // Only fetch a session if credentials were configured.
      const currentSession = system.hasCredentials
        ? await system.connector.getSession()
        : null;

      setSession(currentSession);
      setCredentialsReady(system.hasCredentials);
    } catch (error) {
      setInitError(error?.message ?? 'Failed to initialize the demo system.');
    } finally {
      setInitializing(false);
    }
  }, []);

  React.useEffect(() => {
    let active = true;

    (async () => {
      // Load runtime credentials saved by the user on a previous launch.
      const saved = await loadCredentials();
      if (!active) return;

      if (saved?.supabaseUrl && saved?.supabaseAnonKey && saved?.powersyncUrl) {
        // Merge saved credentials over any baked-in AppEnv values.
        const mergedEnv = { ...AppEnv, ...saved };
        system._applyEnv(mergedEnv);
      }

      await bootstrap(null);
    })();

    return () => { active = false; };
  }, [bootstrap]);

  const handleCredentialsSaved = async (creds) => {
    setInitializing(true);
    setInitError('');
    setShowSettings(false);
    await saveCredentials(creds);
    const mergedEnv = { ...AppEnv, ...creds };
    await bootstrap(mergedEnv);
  };

  if (initializing) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <View style={styles.centeredScreen}>
          <ActivityIndicator size="large" />
          <Text style={styles.subtitle}>Starting up...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (initError) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <View style={styles.centeredScreen}>
          <Text style={styles.errorTitle}>Initialization error</Text>
          <Text style={styles.errorText}>{initError}</Text>
          <Pressable style={[styles.secondaryButton, { marginTop: 16 }]} onPress={() => {
            setInitError('');
            setShowSettings(true);
          }}>
            <Text style={styles.secondaryButtonText}>Open Settings</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if ((!credentialsReady && !skippedSettings) || showSettings) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <SettingsScreen
          onSave={handleCredentialsSaved}
          onSkip={() => { setSkippedSettings(true); setShowSettings(false); }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      {!credentialsReady || session ? (
        <PowerSyncContext.Provider value={system.powersync}>
          <DemoShell
            onLogout={credentialsReady ? async () => {
              await system.connector.logout();
              setSession(null);
            } : null}
            onOpenSettings={() => setShowSettings(true)}
          />
        </PowerSyncContext.Provider>
      ) : (
        <AuthScreen
          onAuthenticated={setSession}
          cactusApiKey={AppEnv.cactusApiKey}
          supabaseUrl={system.connector?.supabaseUrl ?? ''}
          powersyncUrl={system.connector?.powersyncUrl ?? ''}
        />
      )}
    </SafeAreaView>
  );
}

function AuthScreen({ onAuthenticated, cactusApiKey, supabaseUrl, powersyncUrl }) {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [mode, setMode] = React.useState('signin');

  const actionLabel = mode === 'signin' ? 'Sign In' : 'Create Account';

  const submit = async () => {
    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      if (mode === 'signin') {
        const session = await system.connector.login(email.trim(), password);
        onAuthenticated(session);
      } else {
        const { session } = await system.connector.signUp(email.trim(), password);
        if (session) {
          onAuthenticated(session);
        } else {
          setError('Signup succeeded, but no session was returned. Check Supabase email confirmation settings.');
        }
      }
    } catch (submitError) {
      const payloadMessage = submitError?.payload?.message;
      setError(payloadMessage || submitError?.message || 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.authScroll}>
      <Text style={styles.pageTitle}>Cactus + PowerSync Demo</Text>
      <Text style={styles.subtitle}>
        Offline-first React Native app using PowerSync, Supabase Auth/Storage, and on-device Cactus inference.
      </Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{actionLabel}</Text>

        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          keyboardType="email-address"
          autoCapitalize="none"
          style={styles.input}
        />

        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          secureTextEntry
          autoCapitalize="none"
          style={styles.input}
        />

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Pressable style={styles.primaryButton} onPress={submit} disabled={busy}>
          <Text style={styles.primaryButtonText}>{busy ? 'Working...' : actionLabel}</Text>
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError('');
          }}>
          <Text style={styles.secondaryButtonText}>
            {mode === 'signin' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
          </Text>
        </Pressable>
      </View>

      <View style={styles.configCard}>
        <Text style={styles.configTitle}>Runtime endpoints</Text>
        <Text style={styles.configLine}>Supabase: {supabaseUrl || '(missing)'}</Text>
        <Text style={styles.configLine}>PowerSync: {powersyncUrl || '(missing)'}</Text>
        <Text style={styles.configLine}>Cactus API key set: {cactusApiKey ? 'yes' : 'no'}</Text>
      </View>
    </ScrollView>
  );
}

function SettingsScreen({ onSave, onSkip }) {
  const [supabaseUrl, setSupabaseUrl] = React.useState(AppEnv.supabaseUrl ?? '');
  const [supabaseAnonKey, setSupabaseAnonKey] = React.useState(AppEnv.supabaseAnonKey ?? '');
  const [powersyncUrl, setPowersyncUrl] = React.useState(AppEnv.powersyncUrl ?? '');
  const [cactusApiKey, setCactusApiKey] = React.useState(AppEnv.cactusApiKey ?? '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  const save = React.useCallback(async () => {
    if (!supabaseUrl.trim() || !supabaseAnonKey.trim() || !powersyncUrl.trim()) {
      setError('Supabase URL, Anon Key, and PowerSync URL are required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const creds = {
        supabaseUrl: supabaseUrl.trim(),
        supabaseAnonKey: supabaseAnonKey.trim(),
        powersyncUrl: powersyncUrl.trim(),
        cactusApiKey: cactusApiKey.trim() || undefined
      };
      await saveCredentials(creds);
      await onSave(creds);
    } catch (e) {
      setError(e?.message ?? 'Failed to save credentials.');
    } finally {
      setBusy(false);
    }
  }, [supabaseUrl, supabaseAnonKey, powersyncUrl, cactusApiKey, onSave]);

  const reset = React.useCallback(async () => {
    await clearCredentials();
    setSupabaseUrl('');
    setSupabaseAnonKey('');
    setPowersyncUrl('');
    setCactusApiKey('');
    setError('');
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.settingsContainer}>
      <Text style={styles.settingsTitle}>Connection Settings</Text>
      <Text style={styles.settingsSubtitle}>
        Enter your Supabase and PowerSync credentials to enable sync.
        RAG and Transcription work fully offline without credentials.
      </Text>

      <Text style={styles.settingsLabel}>Supabase URL</Text>
      <TextInput
        value={supabaseUrl}
        onChangeText={setSupabaseUrl}
        placeholder="https://xxxx.supabase.co"
        autoCapitalize="none"
        keyboardType="url"
        style={styles.settingsInput}
      />

      <Text style={styles.settingsLabel}>Supabase Anon Key</Text>
      <TextInput
        value={supabaseAnonKey}
        onChangeText={setSupabaseAnonKey}
        placeholder="eyJ..."
        autoCapitalize="none"
        style={styles.settingsInput}
      />

      <Text style={styles.settingsLabel}>PowerSync URL</Text>
      <TextInput
        value={powersyncUrl}
        onChangeText={setPowersyncUrl}
        placeholder="https://xxxx.powersync.journeyapps.com"
        autoCapitalize="none"
        keyboardType="url"
        style={styles.settingsInput}
      />

      <Text style={styles.settingsLabel}>Cactus API Key <Text style={styles.settingsLabelOptional}>(optional)</Text></Text>
      <TextInput
        value={cactusApiKey}
        onChangeText={setCactusApiKey}
        placeholder="sk-..."
        autoCapitalize="none"
        style={styles.settingsInput}
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Pressable style={[styles.primaryButton, { marginTop: 20 }]} onPress={save} disabled={busy}>
        <Text style={styles.primaryButtonText}>{busy ? 'Connecting...' : 'Save & Connect'}</Text>
      </Pressable>

      <Pressable style={styles.secondaryButton} onPress={onSkip}>
        <Text style={styles.secondaryButtonText}>Skip — use offline mode</Text>
      </Pressable>

      <Pressable style={[styles.secondaryButton, { marginTop: 0, borderColor: '#ccc' }]} onPress={reset}>
        <Text style={[styles.secondaryButtonText, { color: '#999' }]}>Clear saved credentials</Text>
      </Pressable>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Model card components — each must be its own component to call hooks
// ---------------------------------------------------------------------------

function ModelCardAction({ isDownloaded, isDownloading, isSelected, blocked, progress, onDownload, onSelect, slug }) {
  if (isDownloaded) {
    return (
      <Pressable
        style={[styles.modelActionButton, isSelected && styles.modelActionButtonSelected]}
        onPress={() => onSelect(slug)}>
        <Text style={[styles.modelActionButtonText, isSelected && styles.modelActionButtonTextSelected]}>
          {isSelected ? '✓ Selected' : 'Select'}
        </Text>
      </Pressable>
    );
  }
  if (isDownloading) {
    return (
      <View style={styles.modelProgressContainer}>
        <View style={styles.modelProgressTrack}>
          <View style={[styles.modelProgressBar, { width: `${progress}%` }]} />
        </View>
        <Text style={styles.modelProgressText}>{progress}%</Text>
      </View>
    );
  }
  return (
    <Pressable
      style={[styles.modelActionButton, blocked && styles.modelActionButtonBlocked]}
      onPress={blocked ? null : onDownload}
      disabled={blocked}>
      <Text style={[styles.modelActionButtonText, blocked && styles.modelActionButtonTextBlocked]}>
        Download
      </Text>
    </Pressable>
  );
}

function LlmModelCard({ model, isSelected, onSelect, anyDownloading, onDownloadingChange }) {
  const lm = useCactusLM({ model: model.slug });
  const progress = Math.round((lm.downloadProgress ?? 0) * 100);

  React.useEffect(() => {
    onDownloadingChange(model.id, lm.isDownloading);
  }, [lm.isDownloading, model.id, onDownloadingChange]);

  return (
    <View style={styles.modelCard}>
      <View style={styles.modelCardHeader}>
        <View style={{ flex: 1 }}>
          <View style={styles.modelCardTitleRow}>
            <Text style={styles.modelCardName}>{model.name}</Text>
            {model.isRecommended ? (
              <View style={styles.recommendedBadge}>
                <Text style={styles.recommendedBadgeText}>Recommended</Text>
              </View>
            ) : null}
            {model.badge ? (
              <View style={[styles.recommendedBadge, { backgroundColor: '#f0fdf4' }]}>
                <Text style={[styles.recommendedBadgeText, { color: '#15803d' }]}>{model.badge}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.modelCardMeta}>
            {model.sizeMb != null ? `${model.sizeMb >= 1000 ? (model.sizeMb / 1000).toFixed(1) + ' GB' : model.sizeMb + ' MB'}` : 'Size unknown'}
          </Text>
        </View>
        <View style={{ marginLeft: 12 }}>
          <ModelCardAction
            isDownloaded={lm.isDownloaded}
            isDownloading={lm.isDownloading}
            isSelected={isSelected}
            blocked={anyDownloading && !lm.isDownloading}
            progress={progress}
            onDownload={() => lm.download()}
            onSelect={onSelect}
            slug={model.slug}
          />
        </View>
      </View>
      <Text style={styles.modelCardDescription}>{model.description}</Text>
    </View>
  );
}

function SttModelCard({ model, isSelected, onSelect, anyDownloading, onDownloadingChange }) {
  const stt = useCactusSTT({ model: model.slug });
  const progress = Math.round((stt.downloadProgress ?? 0) * 100);

  React.useEffect(() => {
    onDownloadingChange(model.id, stt.isDownloading);
  }, [stt.isDownloading, model.id, onDownloadingChange]);

  return (
    <View style={styles.modelCard}>
      <View style={styles.modelCardHeader}>
        <View style={{ flex: 1 }}>
          <View style={styles.modelCardTitleRow}>
            <Text style={styles.modelCardName}>{model.name}</Text>
            {model.isRecommended ? (
              <View style={styles.recommendedBadge}>
                <Text style={styles.recommendedBadgeText}>Recommended</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.modelCardMeta}>
            {model.sizeMb != null ? `${model.sizeMb >= 1000 ? (model.sizeMb / 1000).toFixed(1) + ' GB' : model.sizeMb + ' MB'}` : 'Size unknown'}
          </Text>
        </View>
        <View style={{ marginLeft: 12 }}>
          <ModelCardAction
            isDownloaded={stt.isDownloaded}
            isDownloading={stt.isDownloading}
            isSelected={isSelected}
            blocked={anyDownloading && !stt.isDownloading}
            progress={progress}
            onDownload={() => stt.download()}
            onSelect={onSelect}
            slug={model.slug}
          />
        </View>
      </View>
      <Text style={styles.modelCardDescription}>{model.description}</Text>
    </View>
  );
}

function ModelsScreen({ selectedLlmModel, selectedSttModel, onSelectLlm, onSelectStt }) {
  const [activeTab, setActiveTab] = React.useState('llm');
  // Track which model IDs are currently downloading (across all tabs)
  const [downloadingIds, setDownloadingIds] = React.useState({});
  const anyDownloading = Object.values(downloadingIds).some(Boolean);

  const handleDownloadingChange = React.useCallback((id, isDownloading) => {
    setDownloadingIds(prev => {
      if (prev[id] === isDownloading) return prev;
      return { ...prev, [id]: isDownloading };
    });
  }, []);

  const TABS = [
    { id: 'llm', label: 'LLM' },
    { id: 'embedding', label: 'Embedding' },
    { id: 'stt', label: 'Speech' }
  ];
  const NOTE = {
    llm: 'LLM models power chat completions and RAG queries. Some also support embeddings.',
    embedding: 'Dedicated embedding models for indexing RAG documents. Select one to use for the RAG screen.',
    stt: 'Speech-to-text models power the voice transcription feature.'
  };
  return (
    <View style={{ paddingBottom: 32 }}>
      <View style={styles.modelTabRow}>
        {TABS.map(tab => (
          <Pressable
            key={tab.id}
            onPress={() => setActiveTab(tab.id)}
            style={[styles.modelTabButton, activeTab === tab.id && styles.modelTabButtonActive]}>
            <Text style={[styles.modelTabButtonText, activeTab === tab.id && styles.modelTabButtonTextActive]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.modelsSectionNote}>{NOTE[activeTab]}</Text>
      {activeTab === 'llm' &&
        LLM_MODELS.map(m => (
          <LlmModelCard key={m.id} model={m} isSelected={selectedLlmModel === m.slug}
            onSelect={onSelectLlm} anyDownloading={anyDownloading}
            onDownloadingChange={handleDownloadingChange} />
        ))}
      {activeTab === 'embedding' &&
        EMBEDDING_MODELS.map(m => (
          <LlmModelCard key={m.id} model={m} isSelected={selectedLlmModel === m.slug}
            onSelect={onSelectLlm} anyDownloading={anyDownloading}
            onDownloadingChange={handleDownloadingChange} />
        ))}
      {activeTab === 'stt' &&
        STT_MODELS.map(m => (
          <SttModelCard key={m.id} model={m} isSelected={selectedSttModel === m.slug}
            onSelect={onSelectStt} anyDownloading={anyDownloading}
            onDownloadingChange={handleDownloadingChange} />
        ))}
    </View>
  );
}

// ---------------------------------------------------------------------------

function DemoShell({ onLogout, onOpenSettings }) {
  const [activeScreen, setActiveScreen] = React.useState(SCREENS.models);
  const [selectedLlmModel, setSelectedLlmModel] = React.useState(DEFAULT_LLM_MODEL);
  const [selectedSttModel, setSelectedSttModel] = React.useState(DEFAULT_STT_MODEL);

  React.useEffect(() => {
    loadModelPrefs().then(prefs => {
      if (prefs?.llmModel) setSelectedLlmModel(prefs.llmModel);
      if (prefs?.sttModel) setSelectedSttModel(prefs.sttModel);
    });
  }, []);

  const handleSelectLlm = React.useCallback((slug) => {
    setSelectedLlmModel(slug);
    saveModelPrefs({ llmModel: slug, sttModel: selectedSttModel });
  }, [selectedSttModel]);

  const handleSelectStt = React.useCallback((slug) => {
    setSelectedSttModel(slug);
    saveModelPrefs({ llmModel: selectedLlmModel, sttModel: slug });
  }, [selectedLlmModel]);

  const logCostEvent = React.useCallback(async (feature, metrics) => {
    const totalTokens = Number(metrics?.totalTokens ?? 0);
    const totalTimeMs = Number(metrics?.totalTimeMs ?? 0);
    const cloudHandoff = Boolean(metrics?.cloudHandoff);
    const costs = estimateCosts({ totalTokens, cloudHandoff });

    await system.powersync.execute(
      `INSERT INTO ${TABLES.costEvents}
        (id, created_at, feature, total_tokens, total_time_ms, cloud_handoff, cloud_cost_usd, device_cost_usd, saved_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomId(),
        toIsoNow(),
        feature,
        totalTokens,
        totalTimeMs,
        cloudHandoff ? 1 : 0,
        costs.cloudCost,
        costs.deviceCost,
        costs.saved
      ]
    );

    return costs;
  }, []);

  const content = {
    [SCREENS.models]: (
      <ModelsScreen
        selectedLlmModel={selectedLlmModel}
        selectedSttModel={selectedSttModel}
        onSelectLlm={handleSelectLlm}
        onSelectStt={handleSelectStt}
      />
    ),
    [SCREENS.home]: <HomeScreen lmModel={selectedLlmModel} setActiveScreen={setActiveScreen} />,
    [SCREENS.transcription]: <TranscriptionScreen sttModel={selectedSttModel} logCostEvent={logCostEvent} />,
    [SCREENS.rag]: <RagScreen lmModel={selectedLlmModel} logCostEvent={logCostEvent} />,
    [SCREENS.attachments]: <AttachmentsScreen />,
    [SCREENS.offline]: <OfflineScreen />
  }[activeScreen];

  return (
    <View style={styles.shellContainer}>
      <View style={styles.navBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.navButtonsRow}>
          <NavButton label="Models" active={activeScreen === SCREENS.models} onPress={() => setActiveScreen(SCREENS.models)} />
          <NavButton label="Home" active={activeScreen === SCREENS.home} onPress={() => setActiveScreen(SCREENS.home)} />
          <NavButton
            label="Transcription"
            active={activeScreen === SCREENS.transcription}
            onPress={() => setActiveScreen(SCREENS.transcription)}
          />
          <NavButton label="RAG" active={activeScreen === SCREENS.rag} onPress={() => setActiveScreen(SCREENS.rag)} />
          <NavButton
            label="Attachments"
            active={activeScreen === SCREENS.attachments}
            onPress={() => setActiveScreen(SCREENS.attachments)}
          />
          <NavButton
            label="Offline"
            active={activeScreen === SCREENS.offline}
            onPress={() => setActiveScreen(SCREENS.offline)}
          />
        </ScrollView>

        <Pressable style={styles.logoutButton} onPress={onOpenSettings}>
          <Text style={styles.logoutButtonText}>Settings</Text>
        </Pressable>
        {onLogout ? (
          <Pressable style={styles.logoutButton} onPress={onLogout}>
            <Text style={styles.logoutButtonText}>Logout</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.screenScroll}>{content}</ScrollView>
    </View>
  );
}

function HomeScreen({ lmModel, setActiveScreen }) {
  const status = useStatus();
  const cactusLM = useCactusLM({ model: lmModel });
  const [sessionId, setSessionId] = React.useState(() => randomId());
  const [input, setInput] = React.useState('');
  const scrollRef = React.useRef(null);
  const prevIsGenerating = React.useRef(false);
  const pendingUserContent = React.useRef(null);

  const { data: messages = [] } = useQuery(
    `SELECT id, role, content, created_at
     FROM ${TABLES.chatMessages}
     WHERE session_id = ?
     ORDER BY created_at ASC`,
    [sessionId]
  );

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !cactusLM.isDownloaded || cactusLM.isGenerating) return;
    setInput('');
    pendingUserContent.current = text;

    await system.powersync.execute(
      `INSERT INTO ${TABLES.chatMessages} (id, created_at, session_id, role, content, model)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [randomId(), toIsoNow(), sessionId, 'user', text, lmModel]
    );

    // Build history from current messages + new user message
    const history = messages.map(m => ({ role: m.role, content: m.content }));
    cactusLM.complete({ messages: [...history, { role: 'user', content: text }] });
  };

  // Save assistant message when generation finishes
  React.useEffect(() => {
    if (prevIsGenerating.current && !cactusLM.isGenerating && cactusLM.completion && pendingUserContent.current !== null) {
      system.powersync.execute(
        `INSERT INTO ${TABLES.chatMessages} (id, created_at, session_id, role, content, model)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [randomId(), toIsoNow(), sessionId, 'assistant', cactusLM.completion, lmModel]
      ).catch(console.error);
      pendingUserContent.current = null;
    }
    prevIsGenerating.current = cactusLM.isGenerating;
  }, [cactusLM.isGenerating, cactusLM.completion, sessionId, lmModel]);

  // Auto-scroll to bottom when messages change or streaming
  React.useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages.length, cactusLM.completion]);

  const startNewChat = () => {
    setSessionId(randomId());
    setInput('');
    pendingUserContent.current = null;
  };

  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Overview</Text>
        <Text style={styles.bodyText}>Connected: {status.connected ? 'yes' : 'no'} · Synced: {String(status.hasSynced)}</Text>
      </View>

      <View style={[styles.card, { paddingBottom: 0 }]}>
        <View style={styles.chatHeader}>
          <Text style={styles.sectionTitle}>Chat</Text>
          <Pressable onPress={startNewChat} style={styles.newChatButton}>
            <Text style={styles.newChatButtonText}>New chat</Text>
          </Pressable>
        </View>

        {!cactusLM.isDownloaded && !cactusLM.isDownloading ? (
          <View style={styles.modelNotReadyBanner}>
            <Text style={styles.modelNotReadyText}>
              Model not downloaded. Go to the Models tab to download it.
            </Text>
          </View>
        ) : null}

        <ScrollView
          ref={scrollRef}
          style={styles.chatMessages}
          contentContainerStyle={{ paddingVertical: 8 }}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 && !cactusLM.isGenerating ? (
            <Text style={styles.chatEmptyText}>Start a conversation below.</Text>
          ) : null}
          {messages.map(msg => (
            <View
              key={msg.id}
              style={[
                styles.chatBubble,
                msg.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleAssistant
              ]}
            >
              <Text style={msg.role === 'user' ? styles.chatBubbleTextUser : styles.chatBubbleTextAssistant}>
                {msg.content}
              </Text>
            </View>
          ))}
          {cactusLM.isGenerating && cactusLM.completion ? (
            <View style={[styles.chatBubble, styles.chatBubbleAssistant]}>
              <Text style={styles.chatBubbleTextAssistant}>{cactusLM.completion}</Text>
            </View>
          ) : null}
          {cactusLM.isGenerating && !cactusLM.completion ? (
            <View style={[styles.chatBubble, styles.chatBubbleAssistant]}>
              <Text style={styles.chatBubbleTextAssistant}>...</Text>
            </View>
          ) : null}
        </ScrollView>

        {cactusLM.error ? <Text style={[styles.errorText, { marginHorizontal: 0 }]}>{cactusLM.error}</Text> : null}

        <View style={styles.chatInputRow}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Message"
            style={styles.chatInput}
            editable={!cactusLM.isGenerating && cactusLM.isDownloaded}
            multiline
            maxLength={4000}
            onSubmitEditing={handleSend}
            blurOnSubmit={false}
          />
          <Pressable
            style={[styles.chatSendButton, (!cactusLM.isDownloaded || cactusLM.isGenerating || !input.trim()) && styles.chatSendButtonDisabled]}
            onPress={handleSend}
            disabled={!cactusLM.isDownloaded || cactusLM.isGenerating || !input.trim()}
          >
            <Text style={styles.chatSendButtonText}>↑</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Jump to demos</Text>
        <View style={styles.inlineButtons}>
          <TinyButton label="Transcription" onPress={() => setActiveScreen(SCREENS.transcription)} />
          <TinyButton label="RAG" onPress={() => setActiveScreen(SCREENS.rag)} />
          <TinyButton label="Attachments" onPress={() => setActiveScreen(SCREENS.attachments)} />
          <TinyButton label="Offline Queue" onPress={() => setActiveScreen(SCREENS.offline)} />
        </View>
      </View>
    </View>
  );
}

// How often to feed audio chunks to Cactus streaming STT (ms)
const STREAM_CHUNK_INTERVAL_MS = 1000;
// How often to persist the in-progress transcript to PowerSync/Supabase (ms)
const DB_SYNC_INTERVAL_MS = 3000;

// Parse the WAV 'data' chunk offset from raw bytes
const findWavDataOffset = (wavBytes) => {
  for (let i = 12; i < wavBytes.length - 8; i++) {
    if (wavBytes[i] === 0x64 && wavBytes[i + 1] === 0x61 &&
        wavBytes[i + 2] === 0x74 && wavBytes[i + 3] === 0x61) { // 'data'
      return i + 8;
    }
  }
  return -1;
};

function TranscriptionScreen({ sttModel, logCostEvent }) {
  const stt = useCactusSTT({ model: sttModel });
  const { data: transcripts = [] } = useQuery(
    `SELECT id, created_at, audio_path, transcript, total_tokens, total_time_ms, cloud_handoff
     FROM ${TABLES.transcripts}
     ORDER BY created_at DESC
     LIMIT 12`
  );

  const audioRecorder = useAudioRecorder({
    extension: '.wav',
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 256000,
    ios: {
      outputFormat: 'lpcm',
      audioQuality: 96,
      linearPCMBitDepth: 16,
      linearPCMIsBigEndian: false,
      linearPCMIsFloat: false
    }
  });
  const recorderState = useAudioRecorderState(audioRecorder);
  const [error, setError] = React.useState('');
  const [streaming, setStreaming] = React.useState(false);
  const [lastRun, setLastRun] = React.useState(null);

  // Refs that survive across the streaming interval callbacks
  const rowIdRef = React.useRef(null);
  const bytesSentRef = React.useRef(0);
  const dataOffsetRef = React.useRef(-1);
  const chunkTimerRef = React.useRef(null);
  const dbSyncTimerRef = React.useRef(null);
  const lastDbTextRef = React.useRef('');
  const cumulativeTokensRef = React.useRef(0);
  const cumulativeTimeMsRef = React.useRef(0);
  const startTimeRef = React.useRef(0);

  const formatDuration = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Read new PCM bytes from the WAV file and feed to Cactus
  const feedAudioChunk = React.useCallback(async () => {
    try {
      const uri = audioRecorder.uri;
      if (!uri) return;

      const wavResponse = await fetch(uri);
      const wavBuffer = await wavResponse.arrayBuffer();
      const wavBytes = new Uint8Array(wavBuffer);

      // Find data offset on first read
      if (dataOffsetRef.current < 0) {
        dataOffsetRef.current = findWavDataOffset(wavBytes);
        if (dataOffsetRef.current < 0) return; // header not written yet
      }

      const newStart = dataOffsetRef.current + bytesSentRef.current;
      if (newStart >= wavBytes.length) return; // no new data

      const newPcm = Array.from(wavBytes.slice(newStart));
      if (newPcm.length === 0) return;

      bytesSentRef.current += newPcm.length;

      const result = await stt.streamTranscribeProcess({ audio: newPcm });
      console.log('[StreamSTT] chunk processed, confirmed:', result.confirmed?.length ?? 0,
        'pending:', result.pending?.length ?? 0);

      // Accumulate metrics
      cumulativeTokensRef.current += Number(result.totalTokens ?? 0);
      cumulativeTimeMsRef.current = Date.now() - startTimeRef.current;
    } catch (chunkError) {
      console.warn('[StreamSTT] chunk error (non-fatal):', chunkError?.message);
    }
  }, [audioRecorder.uri, stt]);

  // Periodically persist the current transcript to the PowerSync local DB
  const syncToDb = React.useCallback(async () => {
    const id = rowIdRef.current;
    if (!id) return;

    const currentText = (stt.streamTranscribeConfirmed + stt.streamTranscribePending).trim();
    if (currentText === lastDbTextRef.current) return; // no change, skip

    lastDbTextRef.current = currentText;

    try {
      await system.powersync.execute(
        `UPDATE ${TABLES.transcripts}
         SET transcript = ?, total_tokens = ?, total_time_ms = ?
         WHERE id = ?`,
        [currentText, cumulativeTokensRef.current, cumulativeTimeMsRef.current, id]
      );
      console.log('[StreamSTT] DB synced, length:', currentText.length);
    } catch (dbError) {
      console.warn('[StreamSTT] DB sync error (non-fatal):', dbError?.message);
    }
  }, [stt.streamTranscribeConfirmed, stt.streamTranscribePending]);

  const startStreaming = async () => {
    setError('');
    setLastRun(null);

    try {
      // Mic permission
      const permStatus = await AudioModule.requestRecordingPermissionsAsync();
      if (!permStatus.granted) {
        setError('Microphone permission is required to record audio.');
        return;
      }

      // Insert a placeholder row in PowerSync
      const id = randomId();
      rowIdRef.current = id;
      bytesSentRef.current = 0;
      dataOffsetRef.current = -1;
      lastDbTextRef.current = '';
      cumulativeTokensRef.current = 0;
      startTimeRef.current = Date.now();
      cumulativeTimeMsRef.current = 0;

      await system.powersync.execute(
        `INSERT INTO ${TABLES.transcripts}
          (id, created_at, audio_path, transcript, cloud_handoff, total_tokens, total_time_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, toIsoNow(), '', '', 0, 0, 0]
      );

      // Start Cactus streaming session
      await stt.streamTranscribeStart();

      // Start audio recording
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await audioRecorder.prepareToRecordAsync({
        extension: '.wav',
        sampleRate: 16000,
        numberOfChannels: 1,
        bitRate: 256000,
        ios: {
          outputFormat: 'lpcm',
          audioQuality: 96,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false
        }
      });
      audioRecorder.record();

      setStreaming(true);

      // Periodic audio chunk feeder
      chunkTimerRef.current = setInterval(() => {
        feedAudioChunk();
      }, STREAM_CHUNK_INTERVAL_MS);

      // Periodic DB sync (throttled writes to be kind to Supabase)
      dbSyncTimerRef.current = setInterval(() => {
        syncToDb();
      }, DB_SYNC_INTERVAL_MS);
    } catch (startError) {
      console.error('[StreamSTT] start error:', startError);
      setError(startError?.message || 'Failed to start streaming transcription.');
      rowIdRef.current = null;
    }
  };

  const stopStreaming = async () => {
    // Clear timers first
    if (chunkTimerRef.current) {
      clearInterval(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
    if (dbSyncTimerRef.current) {
      clearInterval(dbSyncTimerRef.current);
      dbSyncTimerRef.current = null;
    }

    try {
      // Stop recording
      await audioRecorder.stop();

      // Feed any remaining audio that was written after the last interval tick
      await feedAudioChunk();

      // Finalize the Cactus stream
      const stopResult = await stt.streamTranscribeStop();
      console.log('[StreamSTT] stopped, final confirmed:', stopResult.confirmed);

      cumulativeTimeMsRef.current = Date.now() - startTimeRef.current;

      const finalText = (stt.streamTranscribeConfirmed + (stopResult.confirmed ?? '')).trim();

      // Final DB update
      const id = rowIdRef.current;
      if (id) {
        await system.powersync.execute(
          `UPDATE ${TABLES.transcripts}
           SET transcript = ?, audio_path = ?, total_tokens = ?, total_time_ms = ?
           WHERE id = ?`,
          [
            finalText,
            audioRecorder.uri ?? '',
            cumulativeTokensRef.current,
            cumulativeTimeMsRef.current,
            id
          ]
        );
      }

      const metrics = {
        totalTokens: cumulativeTokensRef.current,
        totalTimeMs: cumulativeTimeMsRef.current,
        cloudHandoff: false
      };
      const costs = await logCostEvent('transcription', metrics);
      setLastRun({ transcript: finalText, metrics, costs });
    } catch (stopError) {
      console.error('[StreamSTT] stop error:', stopError);
      setError(stopError?.message || 'Failed to stop streaming transcription.');
    } finally {
      setStreaming(false);
      rowIdRef.current = null;
    }
  };

  // Clean up timers on unmount
  React.useEffect(() => {
    return () => {
      if (chunkTimerRef.current) clearInterval(chunkTimerRef.current);
      if (dbSyncTimerRef.current) clearInterval(dbSyncTimerRef.current);
    };
  }, []);

  const liveText = stt.streamTranscribeConfirmed + stt.streamTranscribePending;

  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Streaming on-device transcription</Text>
        <Text style={styles.bodyText}>
          Tap Start to record and transcribe in real-time using Cactus streaming STT. The transcript syncs to Supabase via PowerSync every {DB_SYNC_INTERVAL_MS / 1000}s.
        </Text>

        {!stt.isDownloaded && !stt.isDownloading ? (
          <View style={styles.modelNotReadyBanner}>
            <Text style={styles.modelNotReadyText}>
              STT model not downloaded. Go to the Models tab to download it.
            </Text>
          </View>
        ) : stt.isDownloading ? (
          <Text style={styles.bodyText}>
            Downloading model: {Math.round((stt.downloadProgress ?? 0) * 100)}%
          </Text>
        ) : null}

        <View style={styles.recordingRow}>
          {!streaming ? (
            <Pressable
              style={styles.recordButton}
              onPress={startStreaming}
              disabled={!stt.isDownloaded || stt.isStreamTranscribing}
            >
              <Text style={styles.recordButtonText}>Start</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.stopButton} onPress={stopStreaming}>
              <Text style={styles.stopButtonText}>Stop</Text>
            </Pressable>
          )}
          <Text style={styles.recordingStatus}>
            {streaming
              ? `Streaming ${formatDuration(recorderState.durationMillis)}`
              : lastRun
                ? 'Done'
                : 'Tap Start to begin'}
          </Text>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {stt.error ? <Text style={styles.errorText}>{stt.error}</Text> : null}

        {streaming && liveText ? (
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>Live transcript</Text>
            <Text style={styles.bodyText}>{liveText}</Text>
          </View>
        ) : null}

        {lastRun ? (
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>Last transcription</Text>
            <Text style={styles.bodyText}>{lastRun.transcript || '(empty response)'}</Text>
            <Text style={styles.metricLine}>Tokens: {lastRun.metrics.totalTokens}</Text>
            <Text style={styles.metricLine}>Duration: {lastRun.metrics.totalTimeMs} ms</Text>
            <Text style={styles.metricLine}>Estimated saved: ${lastRun.costs.saved.toFixed(4)}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Recent transcripts (PowerSync local DB)</Text>
        {transcripts.length === 0 ? (
          <Text style={styles.bodyText}>No transcripts yet.</Text>
        ) : (
          transcripts.map((row) => (
            <View key={row.id} style={styles.listRow}>
              <Text style={styles.listLabel}>{row.created_at}</Text>
              <Text numberOfLines={2} style={styles.listValue}>
                {row.transcript}
              </Text>
              <Text style={styles.listMeta}>
                tokens {Number(row.total_tokens ?? 0)} · {Number(row.total_time_ms ?? 0)} ms · cloud {String(Boolean(row.cloud_handoff))}
              </Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

function RagScreen({ lmModel, logCostEvent }) {
  const lm = useCactusLM({ model: lmModel });
  const { data: docs = [] } = useQuery(
    `SELECT id, created_at, title, content, embedding_json
     FROM ${TABLES.documents}
     ORDER BY created_at DESC
     LIMIT 25`
  );

  const { data: queries = [] } = useQuery(
    `SELECT id, created_at, question, answer, total_tokens, total_time_ms
     FROM ${TABLES.queries}
     ORDER BY created_at DESC
     LIMIT 12`
  );

  const [title, setTitle] = React.useState('');
  const [content, setContent] = React.useState('');
  const [question, setQuestion] = React.useState('');
  const [answer, setAnswer] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [analysis, setAnalysis] = React.useState(null);
  const [fileStatus, setFileStatus] = React.useState('');

  const pickAndImportFile = async () => {
    setError('');
    setFileStatus('');

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'text/plain'],
        copyToCacheDirectory: true
      });

      if (result.canceled) return;

      const file = result.assets?.[0];
      if (!file) return;

      setBusy(true);
      setFileStatus(`Reading ${file.name}...`);

      const text = await readFileContent(file);
      const chunks = chunkText(text);

      setFileStatus(`Embedding ${chunks.length} chunk${chunks.length === 1 ? '' : 's'} from ${file.name}...`);

      const baseName = (file.name ?? 'file').replace(/\.[^.]+$/, '');

      for (let i = 0; i < chunks.length; i++) {
        const chunkTitle = chunks.length === 1
          ? baseName
          : `${baseName} (${i + 1}/${chunks.length})`;

        setFileStatus(`Embedding chunk ${i + 1}/${chunks.length}...`);

        const embedding = await lm.embed({ text: `${chunkTitle}\n${chunks[i]}` });
        const rawVec = embedding?.embedding ?? embedding;
        const embeddingJson = JSON.stringify(normalizeVector(rawVec));
        console.log('[RAG Import] embedding type:', typeof rawVec, 'dimensions:', Array.isArray(rawVec) ? rawVec.length : 'n/a');

        await system.powersync.execute(
          `INSERT INTO ${TABLES.documents} (id, created_at, title, content, embedding_json)
           VALUES (?, ?, ?, ?, ?)`,
          [randomId(), toIsoNow(), chunkTitle, chunks[i], embeddingJson]
        );
      }

      const verifyCount = await system.powersync.getAll(
        `SELECT COUNT(*) AS count FROM ${TABLES.documents}`
      );
      console.log('[RAG Import] docs in table after import:', verifyCount[0]?.count);

      setFileStatus(`Imported ${chunks.length} chunk${chunks.length === 1 ? '' : 's'} from ${file.name}`);
    } catch (pickError) {
      setError(pickError?.message ?? 'Failed to import file.');
      setFileStatus('');
    } finally {
      setBusy(false);
    }
  };

  const addDocument = async () => {
    if (!title.trim() || !content.trim()) {
      setError('Provide both a title and content for the RAG corpus.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      const embedding = await lm.embed({ text: `${title.trim()}\n${content.trim()}` });
      const rawVec = embedding?.embedding ?? embedding;
      await system.powersync.execute(
        `INSERT INTO ${TABLES.documents} (id, created_at, title, content, embedding_json)
         VALUES (?, ?, ?, ?, ?)`,
        [randomId(), toIsoNow(), title.trim(), content.trim(), JSON.stringify(normalizeVector(rawVec))]
      );
      setTitle('');
      setContent('');
    } catch (addError) {
      setError(addError?.message ?? 'Failed to add RAG document.');
    } finally {
      setBusy(false);
    }
  };

  const askQuestion = async () => {
    if (!question.trim()) {
      setError('Provide a question.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      let localDocs = await system.powersync.getAll(
        `SELECT id, title, content, embedding_json FROM ${TABLES.documents}`
      );
      console.log('[RAG Query] getAll returned', localDocs.length, 'docs');

      // Fallback: use the reactive useQuery results if getAll is empty
      if (localDocs.length === 0 && docs.length > 0) {
        console.log('[RAG Query] falling back to useQuery docs:', docs.length);
        localDocs = docs;
      }

      if (localDocs.length === 0) {
        throw new Error('Add at least one document before running RAG.');
      }

      const queryEmbedding = await lm.embed({ text: question.trim() });
      const normQ = normalizeVector(queryEmbedding?.embedding ?? queryEmbedding);
      const ranked = localDocs
        .map((doc) => ({
          ...doc,
          similarity: cosineSimilarity(normQ, parseEmbedding(doc.embedding_json) ?? [])
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 3);

      // Assemble context within a token budget (~1024 tokens = 4096 chars)
      const TOKEN_BUDGET_CHARS = 1024 * 4;
      let context = '';
      for (const doc of ranked) {
        const clean = doc.content
          .replace(/<!--\s*Chunk\s+\d+\/\d+.*?-->\n?/g, '')
          .trim();
        if (!clean) continue;
        const entry = `[${doc.title}]\n${clean}\n\n`;
        if (context.length + entry.length > TOKEN_BUDGET_CHARS) {
          const remaining = TOKEN_BUDGET_CHARS - context.length;
          if (remaining > 200) context += entry.slice(0, remaining) + '...\n\n';
          break;
        }
        context += entry;
      }
      context = context.trim();

      const completion = await lm.complete({
        messages: [
          {
            role: 'system',
            content:
              'You are an offline-first assistant. Answer only from provided context. If context is missing, say so.'
          },
          {
            role: 'user',
            content: `Question: ${question.trim()}\n\nContext:\n${context}`
          }
        ],
        tools: [
          {
            name: 'report_sync_status',
            description: 'Return the latest local sync connectivity snapshot.',
            parameters: {
              type: 'object',
              properties: {
                includeUploads: {
                  type: 'boolean',
                  description: 'Whether upload status should be included.'
                }
              },
              required: ['includeUploads']
            }
          }
        ],
        options: {
          temperature: 0.2,
          maxTokens: 240
        }
      });

      const tokenized = await lm.tokenize({ text: question.trim() });
      const tokenWindow = Math.min(tokenized.tokens.length, 12);
      const scoreWindow = tokenWindow > 1
        ? await lm.scoreWindow({
            tokens: tokenized.tokens,
            start: 0,
            end: tokenWindow - 1,
            context: Math.min(tokenWindow, 8)
          })
        : { score: 0 };

      await system.powersync.execute(
        `INSERT INTO ${TABLES.queries}
          (id, created_at, question, answer, context_doc_ids_json, cloud_handoff, total_tokens, total_time_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomId(),
          toIsoNow(),
          question.trim(),
          completion.response,
          JSON.stringify(ranked.map((row) => row.id)),
          completion.cloudHandoff ? 1 : 0,
          Number(completion.totalTokens ?? 0),
          Number(completion.totalTimeMs ?? 0)
        ]
      );

      const costs = await logCostEvent('rag', completion);
      setAnswer(completion.response);
      setAnalysis({
        confidence: completion.confidence,
        cloudHandoff: completion.cloudHandoff,
        totalTokens: completion.totalTokens,
        totalTimeMs: completion.totalTimeMs,
        functionCalls: completion.functionCalls ?? [],
        score: scoreWindow.score,
        costs
      });
    } catch (questionError) {
      setError(questionError?.message ?? 'RAG query failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>RAG with local embeddings</Text>
        <Text style={styles.bodyText}>
          Documents are stored in PowerSync local SQLite and synced to Supabase. Retrieval runs fully on-device using Cactus embeddings.
        </Text>

        {!lm.isDownloaded && !lm.isDownloading ? (
          <View style={styles.modelNotReadyBanner}>
            <Text style={styles.modelNotReadyText}>
              LLM model not downloaded. Go to the Models tab to download it.
            </Text>
          </View>
        ) : lm.isDownloading ? (
          <Text style={styles.bodyText}>
            Downloading model: {Math.round((lm.downloadProgress ?? 0) * 100)}%
          </Text>
        ) : null}

        <Pressable
          style={styles.filePickerButton}
          onPress={pickAndImportFile}
          disabled={busy || lm.isGenerating || !lm.isDownloaded}
        >
          <Text style={styles.filePickerButtonText}>
            {busy && fileStatus ? fileStatus : 'Upload PDF or TXT File'}
          </Text>
        </Pressable>
        {fileStatus && !busy ? <Text style={styles.successText}>{fileStatus}</Text> : null}

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerLabel}>or add manually</Text>
          <View style={styles.dividerLine} />
        </View>

        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Document title"
          style={styles.input}
        />
        <TextInput
          value={content}
          onChangeText={setContent}
          placeholder="Document content"
          multiline
          style={[styles.input, styles.multilineInput]}
        />
        <Pressable style={styles.secondaryButton} onPress={addDocument} disabled={busy || lm.isGenerating}>
          <Text style={styles.secondaryButtonText}>{busy ? 'Working...' : 'Add document to local corpus'}</Text>
        </Pressable>

        <TextInput
          value={question}
          onChangeText={setQuestion}
          placeholder="Ask a question against the corpus"
          multiline
          style={[styles.input, styles.multilineInput]}
        />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {lm.error ? <Text style={styles.errorText}>{lm.error}</Text> : null}

        <Pressable style={styles.primaryButton} onPress={askQuestion} disabled={busy || lm.isGenerating}>
          <Text style={styles.primaryButtonText}>{busy ? 'Running RAG...' : 'Run Local RAG Query'}</Text>
        </Pressable>

        {answer ? (
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>Answer</Text>
            <Text style={styles.bodyText}>{answer}</Text>
            {analysis ? (
              <>
                <Text style={styles.metricLine}>Tokens: {Number(analysis.totalTokens ?? 0)}</Text>
                <Text style={styles.metricLine}>Latency: {Number(analysis.totalTimeMs ?? 0)} ms</Text>
                <Text style={styles.metricLine}>Confidence: {analysis.confidence ?? 'n/a'}</Text>
                <Text style={styles.metricLine}>Cloud handoff: {String(Boolean(analysis.cloudHandoff))}</Text>
                <Text style={styles.metricLine}>Score window: {Number(analysis.score ?? 0).toFixed(4)}</Text>
                <Text style={styles.metricLine}>Estimated saved: ${analysis.costs.saved.toFixed(4)}</Text>
                <Text style={styles.metricLine}>Tool calls: {analysis.functionCalls.length}</Text>
              </>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Stored corpus</Text>
        {docs.length === 0 ? (
          <Text style={styles.bodyText}>No documents yet.</Text>
        ) : (
          docs.map((doc) => (
            <View key={doc.id} style={styles.listRow}>
              <Text style={styles.listLabel}>{doc.title}</Text>
              <Text numberOfLines={2} style={styles.listValue}>
                {doc.content}
              </Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Recent RAG queries</Text>
        {queries.length === 0 ? (
          <Text style={styles.bodyText}>No RAG queries yet.</Text>
        ) : (
          queries.map((row) => (
            <View key={row.id} style={styles.listRow}>
              <Text style={styles.listLabel}>{row.question}</Text>
              <Text numberOfLines={2} style={styles.listValue}>
                {row.answer}
              </Text>
              <Text style={styles.listMeta}>
                {Number(row.total_tokens ?? 0)} tokens · {Number(row.total_time_ms ?? 0)} ms
              </Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

function AttachmentsScreen() {
  const { data: files = [] } = useQuery(
    `SELECT
      f.id,
      f.created_at,
      f.label,
      f.attachment_id,
      f.mime_type,
      f.size_bytes,
      a.state,
      a.local_uri,
      a.filename
     FROM ${TABLES.files} f
     LEFT JOIN attachments a ON a.id = f.attachment_id
     ORDER BY f.created_at DESC
     LIMIT 20`
  );

  const [label, setLabel] = React.useState('');
  const [pickedFile, setPickedFile] = React.useState(null);
  const [error, setError] = React.useState('');
  const [preview, setPreview] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const pickFile = async () => {
    setError('');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const file = result.assets?.[0];
      if (!file) return;
      setPickedFile(file);
      if (!label.trim()) setLabel(file.name ?? 'attachment');
    } catch (pickError) {
      setError(pickError?.message ?? 'Failed to pick file.');
    }
  };

  const createAttachment = async () => {
    if (!pickedFile) {
      setError('Pick a file first.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      if (!system.attachmentQueue) {
        await system.init();
      }
      if (!system.attachmentQueue) {
        throw new Error('Attachment queue not available. Please restart the app.');
      }

      const file = new ExpoFile(pickedFile.uri);
      const data = (await file.bytes()).buffer;

      const ext = (pickedFile.name ?? '').split('.').pop()?.toLowerCase() || 'bin';
      const mimeType = pickedFile.mimeType || 'application/octet-stream';

      await system.attachmentQueue.saveFile({
        data,
        fileExtension: ext,
        mediaType: mimeType,
        updateHook: async (tx, attachment) => {
          await tx.execute(
            `INSERT INTO ${TABLES.files}
              (id, created_at, label, attachment_id, mime_type, size_bytes, file_extension)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              randomId(),
              toIsoNow(),
              label.trim() || pickedFile.name || 'attachment',
              attachment.id,
              mimeType,
              data.byteLength,
              ext
            ]
          );
        }
      });

      setPickedFile(null);
      setLabel('');
    } catch (attachmentError) {
      setError(attachmentError?.message || 'Failed to queue attachment.');
    } finally {
      setBusy(false);
    }
  };

  const readLocalAttachment = async (row) => {
    setError('');
    setPreview('');

    try {
      if (!row.filename) {
        throw new Error('Attachment has not been downloaded yet. Try again after sync.');
      }

      const mime = (row.mime_type ?? '').toLowerCase();
      if (mime.startsWith('text/')) {
        const buffer = await system.localStorage.readFile(row.filename);
        const text = new TextDecoder().decode(buffer);
        setPreview(text);
      } else {
        setPreview(`Binary file (${mime || 'unknown type'}, ${Number(row.size_bytes ?? 0)} bytes) — text preview not available.`);
      }
    } catch (previewError) {
      setError(previewError?.message || 'Unable to preview attachment.');
    }
  };

  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>PowerSync attachments + Supabase Storage</Text>
        <Text style={styles.bodyText}>
          This queues local attachment records, uploads files to Supabase bucket "{AppEnv.supabaseBucket}", and keeps attachment states synced offline.
        </Text>

        <Pressable style={styles.secondaryButton} onPress={pickFile} disabled={busy}>
          <Text style={styles.secondaryButtonText}>{pickedFile ? pickedFile.name : 'Pick a file from disk'}</Text>
        </Pressable>

        {pickedFile ? (
          <Text style={styles.listMeta}>
            {pickedFile.mimeType ?? 'unknown type'} · {pickedFile.size != null ? `${pickedFile.size} bytes` : 'unknown size'}
          </Text>
        ) : null}

        <TextInput value={label} onChangeText={setLabel} placeholder="Attachment label (optional)" style={styles.input} />

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Pressable style={[styles.primaryButton, !pickedFile && styles.disabledButton]} onPress={createAttachment} disabled={busy || !pickedFile}>
          <Text style={styles.primaryButtonText}>{busy ? 'Uploading...' : 'Upload Attachment'}</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Attachment records</Text>
        {files.length === 0 ? (
          <Text style={styles.bodyText}>No attachments yet.</Text>
        ) : (
          files.map((row) => (
            <View key={row.id} style={styles.listRow}>
              <Text style={styles.listLabel}>{row.label}</Text>
              <Text style={styles.listMeta}>
                state: {ATTACHMENT_STATE_LABELS[row.state] ?? String(row.state ?? 'unknown')} · size {Number(row.size_bytes ?? 0)} bytes
              </Text>
              <Text numberOfLines={1} style={styles.listMeta}>
                storage file: {row.filename ?? 'pending'}
              </Text>
              <Pressable style={styles.inlineActionButton} onPress={() => readLocalAttachment(row)}>
                <Text style={styles.inlineActionText}>Preview local file</Text>
              </Pressable>
            </View>
          ))
        )}
      </View>

      {preview ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Local preview</Text>
          <Text style={styles.bodyText}>{preview}</Text>
        </View>
      ) : null}
    </View>
  );
}

function OfflineScreen() {
  const status = useStatus();
  const { data: operations = [] } = useQuery(
    `SELECT id, created_at, note, offline_mode
     FROM ${TABLES.operations}
     ORDER BY created_at DESC
     LIMIT 20`
  );

  const { data: pendingCrud = [], error: pendingCrudError } = useQuery(
    'SELECT COUNT(*) AS count FROM ps_crud'
  );

  const [offlineMode, setOfflineMode] = React.useState(Boolean(system.connector.demoOfflineMode));
  const [note, setNote] = React.useState('Queued while testing offline mode');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const toggleOffline = async (nextValue) => {
    setBusy(true);
    setError('');

    try {
      system.connector.setDemoOfflineMode(nextValue);
      await system.reconnect();
      setOfflineMode(nextValue);
    } catch (toggleError) {
      system.connector.setDemoOfflineMode(!nextValue);
      setOfflineMode(Boolean(system.connector.demoOfflineMode));
      setError(toggleError?.message || 'Failed to toggle offline mode.');
    } finally {
      setBusy(false);
    }
  };

  const addOfflineOperation = async () => {
    if (!note.trim()) {
      setError('Operation note cannot be empty.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      await system.powersync.execute(
        `INSERT INTO ${TABLES.operations} (id, created_at, note, offline_mode)
         VALUES (?, ?, ?, ?)`,
        [randomId(), toIsoNow(), note.trim(), offlineMode ? 1 : 0]
      );
    } catch (operationError) {
      setError(operationError?.message || 'Failed to insert local operation.');
    } finally {
      setBusy(false);
    }
  };

  const pendingCount = Number(pendingCrud[0]?.count ?? 0);

  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Offline-first queue demo</Text>
        <Text style={styles.bodyText}>Connected: {String(status.connected)}</Text>
        <Text style={styles.bodyText}>Has synced: {String(status.hasSynced)}</Text>
        <Text style={styles.bodyText}>Downloading: {String(status.dataFlowStatus.downloading ?? false)}</Text>
        <Text style={styles.bodyText}>Uploading: {String(status.dataFlowStatus.uploading ?? false)}</Text>
        <Text style={styles.bodyText}>
          Pending CRUD rows: {pendingCrudError ? '(ps_crud unavailable)' : pendingCount}
        </Text>

        <Pressable
          style={styles.dangerButton}
          onPress={async () => {
            try {
              await system.powersync.execute('DELETE FROM ps_crud');
              setError('');
            } catch (clearError) {
              setError(clearError?.message || 'Failed to clear upload queue.');
            }
          }}
          disabled={busy}
        >
          <Text style={styles.dangerButtonText}>Clear Upload Queue ({pendingCount})</Text>
        </Pressable>

        <View style={styles.switchRow}>
          <Text style={styles.bodyText}>Demo offline mode</Text>
          <Switch value={offlineMode} onValueChange={toggleOffline} disabled={busy} />
        </View>

        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Operation note"
          style={styles.input}
        />

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Pressable style={styles.primaryButton} onPress={addOfflineOperation} disabled={busy}>
          <Text style={styles.primaryButtonText}>{busy ? 'Saving...' : 'Insert Local Operation'}</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Recent operations</Text>
        {operations.length === 0 ? (
          <Text style={styles.bodyText}>No operations yet.</Text>
        ) : (
          operations.map((row) => (
            <View key={row.id} style={styles.listRow}>
              <Text style={styles.listLabel}>{row.note}</Text>
              <Text style={styles.listMeta}>
                {row.created_at} · created in offline mode {String(Boolean(row.offline_mode))}
              </Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

function NavButton({ label, active, onPress }) {
  return (
    <Pressable style={[styles.navButton, active ? styles.navButtonActive : null]} onPress={onPress}>
      <Text style={[styles.navButtonText, active ? styles.navButtonTextActive : null]}>{label}</Text>
    </Pressable>
  );
}

function TinyButton({ label, onPress }) {
  return (
    <Pressable style={styles.tinyButton} onPress={onPress}>
      <Text style={styles.tinyButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f6f7fb'
  },
  centeredScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10
  },
  shellContainer: {
    flex: 1
  },
  screenScroll: {
    padding: 16,
    paddingBottom: 48
  },
  stack: {
    gap: 12
  },
  navBar: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#ffffff'
  },
  navButtonsRow: {
    gap: 8,
    paddingRight: 8
  },
  navButton: {
    borderWidth: 1,
    borderColor: '#d4d8e1',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#ffffff'
  },
  navButtonActive: {
    borderColor: '#1656d9',
    backgroundColor: '#e8f0ff'
  },
  navButtonText: {
    color: '#2d3448',
    fontWeight: '600'
  },
  navButtonTextActive: {
    color: '#1247b8'
  },
  logoutButton: {
    marginTop: 8,
    alignSelf: 'flex-end'
  },
  logoutButtonText: {
    color: '#9f1239',
    fontWeight: '600'
  },
  authScroll: {
    padding: 18,
    gap: 12
  },
  warningCard: {
    margin: 12,
    borderWidth: 1,
    borderColor: '#fbbf24',
    backgroundColor: '#fff9db',
    borderRadius: 10,
    padding: 10
  },
  warningTitle: {
    fontWeight: '700',
    color: '#854d0e'
  },
  warningText: {
    color: '#854d0e',
    marginTop: 4
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0f172a'
  },
  subtitle: {
    color: '#475569',
    lineHeight: 20
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e7ebf3',
    padding: 14,
    gap: 10
  },
  configCard: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    padding: 12,
    gap: 4
  },
  configTitle: {
    color: '#dbeafe',
    fontWeight: '700'
  },
  configLine: {
    color: '#e2e8f0'
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a'
  },
  bodyText: {
    color: '#334155',
    lineHeight: 20
  },
  metricLine: {
    color: '#1f2937',
    fontWeight: '600'
  },
  input: {
    borderWidth: 1,
    borderColor: '#d4d8e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
    color: '#111827'
  },
  multilineInput: {
    minHeight: 90,
    textAlignVertical: 'top'
  },
  primaryButton: {
    backgroundColor: '#1656d9',
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center'
  },
  disabledButton: {
    opacity: 0.4
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '700'
  },
  secondaryButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#89a4e8',
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#f2f6ff'
  },
  secondaryButtonText: {
    color: '#1f4fbf',
    fontWeight: '700'
  },
  inlineButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  tinyButton: {
    borderWidth: 1,
    borderColor: '#c9d4ee',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#f8fbff'
  },
  tinyButtonText: {
    color: '#1f4fbf',
    fontWeight: '600'
  },
  listRow: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 9,
    padding: 10,
    gap: 4,
    backgroundColor: '#ffffff'
  },
  listLabel: {
    color: '#0f172a',
    fontWeight: '700'
  },
  listValue: {
    color: '#334155'
  },
  listMeta: {
    color: '#64748b',
    fontSize: 12
  },
  inlineActionButton: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#c6d2ef',
    paddingHorizontal: 9,
    paddingVertical: 6,
    marginTop: 2
  },
  inlineActionText: {
    color: '#1f4fbf',
    fontWeight: '600'
  },
  resultCard: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    backgroundColor: '#fbfdff',
    padding: 10,
    gap: 4
  },
  resultTitle: {
    fontWeight: '700',
    color: '#0f172a'
  },
  successText: {
    color: '#166534',
    fontWeight: '600'
  },
  errorTitle: {
    color: '#991b1b',
    fontWeight: '700',
    fontSize: 18
  },
  errorText: {
    color: '#b91c1c'
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  recordingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  recordButton: {
    backgroundColor: '#dc2626',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignItems: 'center'
  },
  recordButtonText: {
    color: '#ffffff',
    fontWeight: '700'
  },
  stopButton: {
    backgroundColor: '#475569',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignItems: 'center'
  },
  stopButtonText: {
    color: '#ffffff',
    fontWeight: '700'
  },
  recordingStatus: {
    color: '#475569',
    fontWeight: '600',
    flex: 1
  },
  filePickerButton: {
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#1656d9',
    borderStyle: 'dashed',
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#f0f5ff'
  },
  filePickerButtonText: {
    color: '#1656d9',
    fontWeight: '700'
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#d4d8e1'
  },
  dividerLabel: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600'
  },
  settingsContainer: {
    padding: 24,
    paddingTop: 32
  },
  settingsTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 10
  },
  settingsSubtitle: {
    fontSize: 14,
    color: '#64748b',
    lineHeight: 20,
    marginBottom: 24
  },
  settingsLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
    marginTop: 12
  },
  settingsLabelOptional: {
    fontWeight: '400',
    color: '#9ca3af'
  },
  settingsInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#0f172a',
    backgroundColor: '#f9fafb'
  },
  // Model card styles
  modelCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0'
  },
  modelCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start'
  },
  modelCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 2
  },
  modelCardName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a'
  },
  modelCardMeta: {
    fontSize: 12,
    color: '#64748b'
  },
  modelCardDescription: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
    marginTop: 10
  },
  recommendedBadge: {
    backgroundColor: '#dbeafe',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 99
  },
  recommendedBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1d4ed8'
  },
  modelActionButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#3b82f6'
  },
  modelActionButtonSelected: {
    backgroundColor: '#3b82f6'
  },
  modelActionButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3b82f6'
  },
  modelActionButtonTextSelected: {
    color: '#fff'
  },
  modelActionButtonBlocked: {
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc'
  },
  modelActionButtonTextBlocked: {
    color: '#94a3b8'
  },
  modelProgressContainer: {
    width: 72,
    alignItems: 'center',
    gap: 4
  },
  modelProgressTrack: {
    width: '100%',
    height: 4,
    backgroundColor: '#e2e8f0',
    borderRadius: 2,
    overflow: 'hidden'
  },
  modelProgressBar: {
    height: '100%',
    backgroundColor: '#3b82f6',
    borderRadius: 2
  },
  modelProgressText: {
    fontSize: 11,
    color: '#64748b'
  },
  modelNotReadyBanner: {
    backgroundColor: '#fef3c7',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12
  },
  modelNotReadyText: {
    color: '#92400e',
    fontSize: 13,
    lineHeight: 18
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8
  },
  newChatButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#f1f5f9'
  },
  newChatButtonText: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '500'
  },
  chatMessages: {
    height: 300,
    marginHorizontal: -16,
    paddingHorizontal: 16
  },
  chatEmptyText: {
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 60
  },
  chatBubble: {
    maxWidth: '80%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 8
  },
  chatBubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: '#6366f1'
  },
  chatBubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: '#f1f5f9'
  },
  chatBubbleTextUser: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20
  },
  chatBubbleTextAssistant: {
    color: '#1e293b',
    fontSize: 14,
    lineHeight: 20
  },
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    marginHorizontal: -16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8
  },
  chatInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    maxHeight: 120,
    backgroundColor: '#f8fafc'
  },
  chatSendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center'
  },
  chatSendButtonDisabled: {
    backgroundColor: '#cbd5e1'
  },
  chatSendButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600'
  },
  modelsSectionNote: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 18,
    marginBottom: 16
  },
  modelTabRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    paddingTop: 4
  },
  modelTabButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc'
  },
  modelTabButtonActive: {
    backgroundColor: '#3b82f6',
    borderColor: '#3b82f6'
  },
  modelTabButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b'
  },
  modelTabButtonTextActive: {
    color: '#fff'
  }
});
