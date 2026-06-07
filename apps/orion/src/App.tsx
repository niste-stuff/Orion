import { useState } from 'react'
import type { Settings } from '@orion/core'
import Sidebar from './Sidebar'
import ChatPanel from './ChatPanel'
import CardPanel from './CardPanel'
import ExportPanel from './ExportPanel'
import ConnectionsManager from './ConnectionsManager'
import Trainer from './Trainer'
import { connectionToSettings } from './connections'
import { useConnections } from './useConnections'
import { useCard } from './useCard'
import { useTheme } from './useTheme'
import { useOrionChat } from './useOrionChat'
import { useCoach } from './useCoach'
import { buildFixInstruction, type CoachFlag } from '@orion/core'

export default function App() {
  // The DEFAULT connection — the single Settings page, also the fallback when no
  // saved connection is active. Held in React state only, never persisted.
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1')
  const [model, setModel] = useState('gpt-4o-mini')
  const defaultSettings: Settings = { apiKey, baseUrl, model }

  // Light/dark theme (dark by default), persisted to localStorage.
  const { theme, toggleTheme } = useTheme()

  // The roster of saved connections + which one is active (localStorage-backed).
  const connections = useConnections()

  // The engine uses the active connection if there is one, else the default.
  const settings: Settings = connections.activeConnection
    ? connectionToSettings(connections.activeConnection)
    : defaultSettings

  // The card (six sections) is loaded from / persisted to local JSON files via
  // this hook. It also owns the card library (list / new / switch).
  const {
    card,
    title,
    setTitle,
    setSection,
    setOpeningMessages,
    setLorebook,
    applyUpdates,
    restoreCard,
    saveStatus,
    error: storageError,
    dismissError,
    cards,
    activeId,
    newCard,
    switchCard,
  } = useCard()

  // The card section the user is currently editing — drives section-aware style
  // retrieval. Defaults to personality until a section's editor gains focus.
  const [activeSection, setActiveSection] = useState('personality')

  // The conversational engine: chat in, section rewrites out.
  const chat = useOrionChat({ settings, card, activeSection, applyUpdates, restoreCard })

  // The quality coach reviews one section's text on demand. It never writes a
  // section — "Fix this" routes back through the engine above.
  const reviewSections = {
    personality: card.personality,
    scenario: card.scenario,
    dialogue_examples: card.dialogue_examples,
    storefront: card.storefront,
    lorebook: card.lorebook.text,
  }
  const coach = useCoach({ settings, sections: reviewSections })

  function handleFixFlag(flag: CoachFlag) {
    if (!coach.review) return
    chat.sendMessage(buildFixInstruction(coach.review.section, flag))
    coach.clearReview()
  }

  // UI shell state.
  const [showCard, setShowCard] = useState(true)
  const [exportOpen, setExportOpen] = useState(false)
  const [connectionsOpen, setConnectionsOpen] = useState(false)
  // Center surface: the chat, or the Trainer (sample-input). Chat state lives in
  // the hook above, so toggling never disturbs the conversation or active card.
  const [view, setView] = useState<'chat' | 'trainer'>('chat')

  return (
    <div className="flex h-screen bg-paper font-sans text-ink">
      <Sidebar
        settings={defaultSettings}
        setApiKey={setApiKey}
        setBaseUrl={setBaseUrl}
        setModel={setModel}
        activeLabel={connections.activeConnection?.label ?? null}
        onOpenConnections={() => setConnectionsOpen(true)}
        showCard={showCard}
        onToggleCard={() => setShowCard((v) => !v)}
        onExport={() => setExportOpen(true)}
        theme={theme}
        onToggleTheme={toggleTheme}
        cards={cards}
        activeId={activeId}
        title={title}
        onSetTitle={setTitle}
        onNewCard={newCard}
        onSwitchCard={switchCard}
        trainerActive={view === 'trainer'}
        onToggleTrainer={() => setView((v) => (v === 'trainer' ? 'chat' : 'trainer'))}
      />

      {/* Center — the chat is the primary surface. */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* Persistence error banner */}
        {storageError && (
          <div className="flex items-center justify-between gap-3 border-b border-red-200/70 bg-red-50/70 px-6 py-2.5 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            <span>Storage error: {storageError}</span>
            <button
              type="button"
              onClick={dismissError}
              className="shrink-0 rounded-md px-2 py-0.5 text-xs font-medium text-red-700 transition hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900/40"
            >
              Dismiss
            </button>
          </div>
        )}

        {view === 'trainer' ? (
          <Trainer onClose={() => setView('chat')} />
        ) : (
          <ChatPanel
            messages={chat.messages}
            loading={chat.loading}
            error={chat.error}
            onSend={chat.sendMessage}
            onDeleteMessage={chat.deleteFrom}
            onDismissError={chat.dismissError}
            review={coach.review}
            reviewing={coach.reviewingSection !== null}
            reviewError={coach.reviewError}
            onFixFlag={handleFixFlag}
            onDismissReview={coach.clearReview}
          />
        )}
      </main>

      {showCard && (
        <CardPanel
          card={card}
          setSection={setSection}
          setOpeningMessages={setOpeningMessages}
          setLorebook={setLorebook}
          saveStatus={saveStatus}
          onReviewSection={coach.runReview}
          reviewingSection={coach.reviewingSection}
          onActiveSection={setActiveSection}
        />
      )}

      {exportOpen && (
        <ExportPanel
          title={title}
          setTitle={setTitle}
          card={card}
          onClose={() => setExportOpen(false)}
        />
      )}

      {connectionsOpen && (
        <ConnectionsManager
          connections={connections.connections}
          activeId={connections.activeId}
          onAdd={connections.addConnection}
          onUpdate={connections.updateConnection}
          onDelete={connections.deleteConnection}
          onDuplicate={connections.duplicateConnection}
          onSetActive={connections.setActive}
          onClose={() => setConnectionsOpen(false)}
        />
      )}
    </div>
  )
}
