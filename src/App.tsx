import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  formatLongDate,
  formatMonthTitle,
  formatShortDate,
  formatTime,
  isValidDateString,
  isValidTimeString,
  monthGrid,
  parseDateString,
  shiftMonth,
  toDateString,
} from '../shared/dates'
import { toAssistantPlace } from '../shared/places'
import type { AssistantSource, LatLon, MealMoment, Plan } from '../shared/types'
import { AiKeyPrompt } from './ai/AiKeyPrompt'
import { COMFORT_CUISINES, pickForMoment } from './ai/local'
import { askFoodAssistant } from './ai/provider'
import { useAiStatus } from './ai/useAiStatus'
import type { AssistantPlace } from './ai/types'
import { CUISINES, NEIGHBORHOODS, places, type Mode, type Place } from './data/places'
import { formatMiles, haversineMiles, travelMinutes } from './data/travel'
import { Icon, type IconName } from './icons'
import { useUserData } from './state/useUserData'
import { useDialog } from './useDialog'
import { useSeattleClock, useSeattleWeather } from './useSeattle'

/** The demo profile. Change the name here; there is no sign-in. */
const DEMO_USER = { name: 'Alex Morgan', firstName: 'Alex', initials: 'AM' }
/** Suggested arrival time in the plan dialog, by current Seattle meal moment. */
const DEFAULT_TIME: Record<MealMoment, string> = { breakfast: '09:00', lunch: '12:30', dinner: '19:00' }

type ViewPlace = Place & { travel: number; distanceLabel: string; distanceFromUser: number | null }
type Confirmation = { place: ViewPlace; date: string; time: string }
type ChatMessage = { role: 'user' | 'assistant'; text: string; source?: AssistantSource }

const MODES: { key: Mode; label: string }[] = [
  { key: 'walk', label: 'Walk' },
  { key: 'bike', label: 'Bike' },
  { key: 'car', label: 'Drive' },
]

const PLACE_IDS = new Set(places.map((place) => place.id))
const PLACE_BY_ID = new Map(places.map((place) => [place.id, place]))

const SpeechRecognitionCtor = typeof window === 'undefined' ? undefined : (window.SpeechRecognition ?? window.webkitSpeechRecognition)

function isCitywide(area: string): boolean {
  const value = area.trim().toLowerCase()
  return value === '' || value === 'seattle' || value === 'seattle, wa' || value === 'seattle wa'
}

function formatWhen(date: string, time?: string): string {
  const day = formatLongDate(date)
  return time && isValidTimeString(time) ? `${day} at ${formatTime(time)}` : day
}

function PlacePhoto({ place, label, eager = false }: { place: Place; label?: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className="photo-fallback" role="img" aria-label={`Photo unavailable for ${place.name}`}>
        Photo unavailable
      </div>
    )
  }
  return (
    <img
      src={place.image}
      alt={label ?? `${place.name}, a ${place.cuisine.toLowerCase()} stand-in photo`}
      width={640}
      height={427}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}

function Nav({ tab, setTab }: { tab: string; setTab: (value: string) => void }) {
  const items: Array<[IconName, string]> = [
    ['home', 'Discover'],
    ['calendar', 'Plans'],
    ['heart', 'Saved'],
    ['user', 'Profile'],
  ]
  return (
    <nav className="nav" aria-label="Main">
      {items.map(([icon, label]) => (
        <button
          key={icon}
          type="button"
          data-testid={`nav-${icon}`}
          onClick={() => setTab(icon)}
          className={tab === icon ? 'nav-item active' : 'nav-item'}
          aria-current={tab === icon ? 'page' : undefined}
        >
          <Icon name={icon} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}

function ResultCard({
  place,
  mode,
  saved,
  reason,
  eager,
  onSave,
  onDetails,
  onPlan,
}: {
  place: ViewPlace
  mode: Mode
  saved: boolean
  reason?: string
  eager: boolean
  onSave: () => void
  onDetails: () => void
  onPlan: () => void
}) {
  return (
    <article className="result-card" data-testid="place-card" data-place-id={place.id}>
      <div className="result-image">
        <PlacePhoto place={place} eager={eager} />
        <button
          type="button"
          className={saved ? 'save saved' : 'save'}
          onClick={onSave}
          aria-pressed={saved}
          aria-label={saved ? `Remove ${place.name} from saved` : `Save ${place.name}`}
          data-testid="save-toggle"
        >
          <Icon name="heart" size={19} filled={saved} />
        </button>
        <span className="cuisine-pill">{place.cuisine}</span>
      </div>
      <div className="result-body">
        <div className="restaurant-info">
          <div>
            <h3>{place.name}</h3>
            <p>
              {place.price} · {place.distanceLabel} · {place.neighborhood}
            </p>
          </div>
          {place.rating != null && (
            <span className="rating" aria-label={`Public rating ${place.rating} out of 5`}>
              <Icon name="star" size={14} />
              {place.rating}
            </span>
          )}
        </div>
        <p className="note">{place.note}</p>
        {reason && (
          <p className="ai-reason">
            <Icon name="spark" size={15} />
            <span>
              <strong>Why it fits: </strong>
              {reason}
            </span>
          </p>
        )}
        <div className="serving-price">
          <span>Approx. one serving per person</span>
          <strong>${place.serving}</strong>
        </div>
        <div className="time-breakdown">
          <div>
            <Icon name={mode} />
            <span>
              <strong>{place.travel} min</strong> travel
            </span>
          </div>
          <b aria-hidden="true">+</b>
          <div>
            <Icon name="clock" />
            <span>
              <strong>{place.wait} min</strong> est. wait
            </span>
          </div>
          <div className="total">
            <strong>{place.travel + place.wait} min</strong>
            <span>total</span>
          </div>
        </div>
        <div className="card-actions">
          <button type="button" onClick={onDetails}>
            View details
          </button>
          <button type="button" className="plan-btn" onClick={onPlan}>
            Add to calendar <Icon name="calendar" size={16} />
          </button>
        </div>
      </div>
    </article>
  )
}

function FilterSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useDialog<HTMLElement>(onClose)
  return (
    <div className="sheet-backdrop" data-testid="filter-sheet" onClick={onClose}>
      <section
        ref={ref}
        className="filter-sheet"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="filters-title"
        tabIndex={-1}
      >
        {children}
      </section>
    </div>
  )
}

function Modal({
  onClose,
  className,
  label,
  labelledBy,
  testId,
  closeOnBackdrop = false,
  children,
}: {
  onClose: () => void
  className: string
  label?: string
  labelledBy?: string
  testId: string
  closeOnBackdrop?: boolean
  children: ReactNode
}) {
  const ref = useDialog<HTMLElement>(onClose)
  return (
    <div className="confirmation-backdrop" onClick={closeOnBackdrop ? onClose : undefined}>
      <section
        ref={ref}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        data-testid={testId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </section>
    </div>
  )
}

export default function App() {
  const clock = useSeattleClock()
  const today = clock.today
  const moment = clock.moment
  const weather = useSeattleWeather()
  const [tab, setTab] = useState('home')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [area, setArea] = useState('Seattle, WA')
  const [cuisine, setCuisine] = useState('All food')
  const [budget, setBudget] = useState('')
  const [date, setDate] = useState(today)
  const [mode, setMode] = useState<Mode>('walk')
  const userData = useUserData(PLACE_IDS)
  const saved = userData.saved
  const [editing, setEditing] = useState<{ id: string; date: string; time: string } | null>(null)
  const [editError, setEditError] = useState('')
  const [editBusy, setEditBusy] = useState(false)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const { year, month } = parseDateString(today)
    return { year, month }
  })
  const [assistantVisible, setAssistantVisible] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [assistantBusy, setAssistantBusy] = useState(false)
  const sendingRef = useRef(false)
  /** Area/budget the assistant wrote into the filters, with the value it replaced. They belong to that answer only. */
  const assistantApplied = useRef<{ area?: { value: string; previous: string }; budget?: { value: string; previous: string } }>({})
  const [assistantPreference, setAssistantPreference] = useState<string | null>(null)
  const [assistantMaxTravel, setAssistantMaxTravel] = useState<number | null>(null)
  const [showChatResults, setShowChatResults] = useState(false)
  const [chatIds, setChatIds] = useState<string[]>([])
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [schedulePlace, setSchedulePlace] = useState<ViewPlace | null>(null)
  const [scheduleTime, setScheduleTime] = useState('')
  const [scheduleError, setScheduleError] = useState('')
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const savingRef = useRef(false)
  const [details, setDetails] = useState<ViewPlace | null>(null)
  const [listening, setListening] = useState(false)
  const [voiceNote, setVoiceNote] = useState('')
  const [locationNote, setLocationNote] = useState('')
  const [userLocation, setUserLocation] = useState<LatLon | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const ai = useAiStatus()
  /** Open while AI is not set up (development only). `pending` is the message to send once the prompt closes. */
  const [keyPrompt, setKeyPrompt] = useState<{ pending: string | null } | null>(null)

  // The profile shows whether AI is on, so re-ask the server each time that tab opens.
  const refreshAi = ai.refresh
  useEffect(() => {
    if (tab === 'user') void refreshAi()
  }, [tab, refreshAi])

  // A tab left open past midnight should not keep offering yesterday as the plan date.
  useEffect(() => {
    setDate((current) => (current < today ? today : current))
  }, [today])

  const view = useMemo<ViewPlace[]>(
    () =>
      places.map((place) => ({
        ...place,
        travel: travelMinutes(place.miles, mode),
        distanceLabel: `about ${formatMiles(place.miles)}`,
        distanceFromUser: userLocation ? haversineMiles(userLocation, place) : null,
      })),
    [mode, userLocation],
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const named = NEIGHBORHOODS.find((name) => name.toLowerCase() === area.trim().toLowerCase())
    const budgetCap = budget ? Number(budget) : null
    const matches = view.filter((place) => {
      const blob = `${place.name} ${place.cuisine} ${place.neighborhood} ${place.address} ${place.dishes.join(' ')} ${place.note}`.toLowerCase()
      if (needle && !blob.includes(needle)) return false
      if (!isCitywide(area)) {
        if (named) {
          if (place.neighborhood !== named) return false
        } else if (!blob.includes(area.trim().toLowerCase())) return false
      }
      if (cuisine !== 'All food' && place.cuisine !== cuisine) return false
      if (budgetCap && place.serving > budgetCap) return false
      if (assistantPreference === 'Comfort food' && !COMFORT_CUISINES.includes(place.cuisine)) return false
      if (assistantPreference && assistantPreference !== 'Comfort food' && assistantPreference !== 'Surprise me' && place.cuisine !== assistantPreference) {
        return false
      }
      if (assistantMaxTravel && place.travel + place.wait > assistantMaxTravel) return false
      return true
    })
    if (userLocation) matches.sort((a, b) => (a.distanceFromUser ?? 0) - (b.distanceFromUser ?? 0))
    return matches
  }, [view, query, area, cuisine, budget, assistantPreference, assistantMaxTravel, userLocation])

  // Profile area picker: the current area (even a custom one typed in Filters) must always be a selectable option.
  const profileArea = isCitywide(area) ? 'Seattle, WA' : (NEIGHBORHOODS.find((name) => name.toLowerCase() === area.trim().toLowerCase()) ?? area)
  const profileAreaIsCustom = !isCitywide(area) && !(NEIGHBORHOODS as readonly string[]).includes(profileArea)

  const grouped = useMemo(() => {
    if (!isCitywide(area) || query.trim() || userLocation) return [{ name: '', places: filtered }]
    return NEIGHBORHOODS.map((name) => ({
      name,
      places: filtered.filter((place) => place.neighborhood === name),
    })).filter((group) => group.places.length)
  }, [filtered, area, query, userLocation])

  const momentPick = useMemo(() => {
    const pick = pickForMoment(moment, view.map((place) => toAssistantPlace(place, mode)))
    return pick ? view.find((place) => place.id === pick.id) ?? null : null
  }, [view, moment, mode])

  const plans = useMemo(() => userData.plans.filter((plan) => PLACE_BY_ID.has(plan.placeId)), [userData.plans])
  const chatPlaces = chatIds.map((id) => view.find((place) => place.id === id)).filter((place): place is ViewPlace => Boolean(place))
  const selectedDate = formatWhen(date)
  const calendarCells = monthGrid(calendarMonth.year, calendarMonth.month)
  const plansForDay = plans.filter((plan) => plan.date === date)
  const upcomingElsewhere = plans
    .filter((plan) => plan.date >= today && plan.date !== date)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
    .slice(0, 5)

  function dateKey(day: number): string {
    return toDateString(calendarMonth.year, calendarMonth.month, day)
  }

  function pickDate(value: string) {
    // Clearing a date input yields "", which must never reach the calendar math.
    if (isValidDateString(value)) setDate(value)
  }

  function showMonthOf(value: string) {
    if (!isValidDateString(value)) return
    const { year, month } = parseDateString(value)
    setCalendarMonth({ year, month })
  }

  function toggleSave(id: string) {
    void userData.toggleSaved(id, !saved.includes(id))
  }

  function resetFilters() {
    setCuisine('All food')
    setBudget('')
    setArea('Seattle, WA')
    setDate(today)
    setAssistantPreference(null)
    setAssistantMaxTravel(null)
    setQuery('')
  }

  function openSchedule(place: ViewPlace) {
    setSchedulePlace(place)
    setScheduleTime(DEFAULT_TIME[clock.moment])
    setScheduleError('')
    if (date < today) setDate(today)
  }

  async function confirmPlan() {
    if (!schedulePlace || !isValidDateString(date) || !isValidTimeString(scheduleTime) || savingRef.current) return
    savingRef.current = true
    setScheduleSaving(true)
    setScheduleError('')
    const result = await userData.createPlan({ placeId: schedulePlace.id, date, time: scheduleTime })
    savingRef.current = false
    setScheduleSaving(false)
    if (!result.ok) {
      setScheduleError(result.message)
      return
    }
    setConfirmation({ place: schedulePlace, date, time: scheduleTime })
    setSchedulePlace(null)
  }

  async function saveEdit() {
    if (!editing || editBusy) return
    const original = userData.plans.find((plan) => plan.id === editing.id)
    if (!original) return setEditing(null)
    if (!isValidDateString(editing.date) || !isValidTimeString(editing.time)) {
      setEditError('Pick a valid date and time.')
      return
    }
    setEditBusy(true)
    setEditError('')
    const changes = {
      ...(editing.date !== original.date ? { date: editing.date } : {}),
      ...(editing.time !== original.time ? { time: editing.time } : {}),
    }
    const result = Object.keys(changes).length ? await userData.updatePlan(editing.id, changes) : { ok: true as const, value: original }
    setEditBusy(false)
    if (!result.ok) {
      setEditError(result.message)
      return
    }
    setEditing(null)
    setDate(result.value.date)
    showMonthOf(result.value.date)
  }

  async function removePlan(plan: Plan) {
    if (editBusy) return
    setEditBusy(true)
    setEditError('')
    const result = await userData.deletePlan(plan.id)
    setEditBusy(false)
    if (!result.ok) {
      setEditError(result.message)
      return
    }
    setEditing(null)
  }

  function openAssistant() {
    setAssistantVisible(true)
    void ai.refresh().then(({ promptable }) => {
      if (promptable) setKeyPrompt({ pending: null })
    })
  }

  function closeKeyPrompt(nowReady: boolean) {
    if (nowReady) ai.markReady()
    const pending = keyPrompt?.pending
    setKeyPrompt(null)
    if (pending) void sendMessage(pending, true)
  }

  async function sendMessage(text = chatInput, skipKeyCheck = false) {
    const trimmed = text.trim()
    if (!trimmed || sendingRef.current) return
    sendingRef.current = true
    try {
      // The setup check only runs where the setup prompt exists (development). On stage, nothing blocks the answer.
      if (!skipKeyCheck && ai.keyPromptEnabled && (await ai.refresh()).promptable) {
        setKeyPrompt({ pending: trimmed })
        return
      }
      setChatInput('')
      setShowChatResults(false)
      setMessages((current) => [...current, { role: 'user', text: trimmed }])
      setAssistantBusy(true)
      const applied = assistantApplied.current
      const userArea = applied.area && applied.area.value === area ? applied.area.previous : area
      const userBudget = applied.budget && applied.budget.value === budget ? applied.budget.previous : budget
      const named = NEIGHBORHOODS.find((name) => name.toLowerCase() === userArea.trim().toLowerCase()) ?? null
      const summaries: AssistantPlace[] = view.map((place) => toAssistantPlace(place, mode))
      const response = await askFoodAssistant(
        {
          message: trimmed,
          location: userArea,
          neighborhood: named,
          cuisine: cuisine === 'All food' ? null : cuisine,
          mode,
          budget: userBudget ? Number(userBudget) : null,
          mealMoment: clock.moment,
          seattleTime: clock.dateTime,
          userLocation,
        },
        summaries,
      )
      // Each answer replaces the filters the previous answer set; filters the user chose stay.
      setAssistantPreference(response.preference)
      setAssistantMaxTravel(response.maxTravelMinutes)
      if (response.neighborhood) {
        setArea(response.neighborhood)
        applied.area = { value: response.neighborhood, previous: userArea }
      } else {
        if (applied.area) setArea(userArea)
        applied.area = undefined
      }
      if (response.maxBudget) {
        setBudget(String(response.maxBudget))
        applied.budget = { value: String(response.maxBudget), previous: userBudget }
      } else {
        if (applied.budget) setBudget(userBudget)
        applied.budget = undefined
      }
      setReasons(response.reasons)
      setChatIds(response.rankedIds)
      setShowChatResults(response.rankedIds.length > 0)
      setMessages((current) => [...current, { role: 'assistant', text: response.reply, source: response.source }])
    } finally {
      sendingRef.current = false
      setAssistantBusy(false)
    }
  }

  function requestLocation() {
    if (userLocation) {
      setUserLocation(null)
      setLocationNote('')
      return
    }
    if (!navigator.geolocation) {
      setLocationNote('This browser has no location service. Browse by neighborhood instead.')
      return
    }
    setLocationNote('Finding you…')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({ lat: position.coords.latitude, lon: position.coords.longitude })
        setLocationNote('Sorted by distance from you. Travel times are still estimates from Pike Place Market.')
      },
      (error) =>
        setLocationNote(
          error.code === error.PERMISSION_DENIED
            ? 'Location permission was blocked. Browse by neighborhood instead.'
            : "Couldn't get your location right now. Browse by neighborhood instead.",
        ),
      { timeout: 10_000, maximumAge: 300_000 },
    )
  }

  function startVoice() {
    if (!SpeechRecognitionCtor || listening) return
    const recognition = new SpeechRecognitionCtor()
    setVoiceNote('')
    setListening(true)
    recognition.lang = 'en-US'
    recognition.onresult = (event) => {
      setChatInput(event.results[0][0].transcript)
      setListening(false)
    }
    recognition.onerror = (event) => {
      setListening(false)
      setVoiceNote(
        event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'Microphone access is blocked. Type your request instead.'
          : "Didn't catch that. Try again, or type your request.",
      )
    }
    recognition.onend = () => setListening(false)
    try {
      recognition.start()
    } catch {
      setListening(false)
      setVoiceNote('The microphone is not available right now. Type your request instead.')
    }
  }

  return (
    <main className="stage">
      <section className="phone">
        <header className="topbar">
          <button type="button" className="avatar" onClick={() => setTab('user')} aria-label={`${DEMO_USER.initials}, open profile`}>
            {DEMO_USER.initials}
          </button>
          <button type="button" className="location" onClick={() => setFiltersOpen(true)}>
            <span>YOUR AREA</span>{' '}
            <strong>
              <Icon name="pin" size={15} />
              <em>{area}</em>
            </strong>
            <span className="visually-hidden">, change filters</span>
          </button>
          <button type="button" className="icon-btn" data-testid="open-filters" onClick={() => setFiltersOpen(true)} aria-label="Filters">
            <Icon name="sliders" />
          </button>
        </header>
        <div className="content">
          {tab === 'home' && (
            <>
              <div className="intro">
                <p className="eyebrow">FIND YOUR NEXT BITE</p>
                <h1>What are you craving?</h1>
              </div>
              {!assistantVisible && (
                <button type="button" className="customization-button" data-testid="open-assistant" onClick={openAssistant}>
                  <span>
                    <Icon name="spark" />
                    <span>
                      <strong>Ask the food assistant</strong>
                      <small>Tell it a cuisine, budget, neighborhood, or time</small>
                    </span>
                  </span>
                  <Icon name="arrow" />
                </button>
              )}
              {assistantVisible && (
                <section className="ai-assistant" data-testid="assistant" aria-label="Food assistant">
                  <button type="button" className="ai-heading" onClick={() => setAssistantVisible(false)} aria-expanded="true">
                    <span className="ai-mark">
                      <Icon name="spark" />
                    </span>
                    <span>
                      <strong>Your food assistant</strong>{' '}
                      <small data-testid="ai-subtitle">Ask for a cuisine, budget, or time</small>
                      <span className="visually-hidden">. Hide the assistant</span>
                    </span>
                    <Icon name="close" size={18} />
                  </button>
                  {ai.showSetup && (
                    <div className="ai-setup-banner" role="status" data-testid="ai-setup-banner">
                      <p>
                        <strong>{ai.state === 'missing-key' ? 'AI is off: no API key yet.' : "AI is off: the app server isn't running."}</strong>{' '}
                        This is a setup step, not a bug. Until it's fixed, answers use basic keyword matching.
                      </p>
                      {ai.state === 'missing-key' && (
                        <button type="button" onClick={() => setKeyPrompt({ pending: null })}>
                          Add API key
                        </button>
                      )}
                    </div>
                  )}
                  {!messages.length && momentPick && (
                    <div className="context-intro">
                      <div className="context-weather" data-testid="weather">
                        <span>
                          <Icon name="clock" size={15} />
                          {moment}
                        </span>
                        <span>{weather.label}</span>
                        {!weather.live && <i>SIMULATED</i>}
                      </div>
                      <p>
                        Hello {DEMO_USER.firstName}!{' '}
                        {weather.live
                          ? `It's ${weather.label.replace(' · ', ' and ').toLowerCase()} in Seattle right now.`
                          : 'Live weather is unavailable, so the weather shown is simulated.'}{' '}
                        For {moment}, a strong pick is <strong>{momentPick.name}</strong> on {momentPick.street} in {momentPick.neighborhood}.
                      </p>
                      <div className="context-pick">
                        <PlacePhoto place={momentPick} />
                        <div>
                          <span>ONE PICK FOR RIGHT NOW</span>
                          <strong>{momentPick.name}</strong>
                          <small>
                            ${momentPick.serving}/person · {momentPick.travel} min {mode === 'car' ? 'drive' : mode}
                          </small>
                        </div>
                        <button type="button" onClick={() => openSchedule(momentPick)} aria-label={`Plan a visit to ${momentPick.name}`}>
                          <Icon name="calendar" size={17} />
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="chat-body">
                    <div aria-live="polite" data-testid="chat-log">
                      {messages.map((message, index) => (
                        <div
                          className={message.role === 'user' ? 'message user-message' : 'message'}
                          key={index}
                          data-testid={message.role === 'user' ? 'user-message' : 'assistant-message'}
                        >
                          {message.role === 'user' && <span className="visually-hidden">You said: </span>}
                          {message.text}
                          {ai.demoDebug && message.source && (
                            <small className="source-tag" data-testid="assistant-source">
                              source: {message.source}
                            </small>
                          )}
                        </div>
                      ))}
                      {assistantBusy && (
                        <div className="message typing" role="status" data-testid="assistant-typing">
                          <span className="dots" aria-hidden="true">
                            <i />
                            <i />
                            <i />
                          </span>
                          Looking through Seattle places…
                        </div>
                      )}
                    </div>
                    {showChatResults && (
                      <div className="chat-results" data-testid="chat-results">
                        <p>TOP CHOICES FOR YOU</p>
                        {chatPlaces.map((place, index) => (
                          <article className="chat-choice" key={place.id} data-testid="chat-pick" data-place-id={place.id}>
                            <PlacePhoto place={place} />
                            <button type="button" className="chat-choice-open" onClick={() => setDetails(place)}>
                              <span>
                                #{index + 1} · {place.cuisine}
                              </span>{' '}
                              <strong>{place.name}</strong>{' '}
                              <small>
                                ${place.serving}/person · {place.travel} min {mode === 'car' ? 'drive' : mode} · {place.wait} min wait
                              </small>
                              <span className="visually-hidden">. View details</span>
                            </button>
                            <button type="button" onClick={() => openSchedule(place)} aria-label={`Add ${place.name} to calendar`} data-testid="chat-pick-plan">
                              <Icon name="calendar" size={17} />
                            </button>
                          </article>
                        ))}
                        <small className="chat-results-note">Travel and wait times are estimates, not live traffic.</small>
                      </div>
                    )}
                    <div className="suggested">
                      <button type="button" onClick={() => void sendMessage('Comfort food')} disabled={assistantBusy}>
                        Comfort food
                      </button>
                      <button type="button" onClick={() => void sendMessage('I have 30 minutes')} disabled={assistantBusy}>
                        30 minutes
                      </button>
                      <button type="button" onClick={() => void sendMessage('Shortest travel time')} disabled={assistantBusy}>
                        Shortest trip
                      </button>
                      <button type="button" onClick={() => void sendMessage('Surprise me')} disabled={assistantBusy}>
                        Surprise me
                      </button>
                    </div>
                    <button type="button" className="location-permission" data-testid="use-location" onClick={requestLocation} aria-pressed={Boolean(userLocation)}>
                      <Icon name="pin" size={15} /> {userLocation ? 'Stop sorting by my location' : 'Sort by my current location'}
                    </button>
                    {locationNote && (
                      <p className="location-note" role="status" data-testid="location-note">
                        {locationNote}
                      </p>
                    )}
                    {voiceNote && (
                      <p className="location-note" role="status" data-testid="voice-note">
                        {voiceNote}
                      </p>
                    )}
                    <form
                      className="chat-input"
                      onSubmit={(event) => {
                        event.preventDefault()
                        void sendMessage()
                      }}
                    >
                      <input
                        data-testid="chat-input"
                        value={chatInput}
                        maxLength={500}
                        onChange={(event) => setChatInput(event.target.value)}
                        placeholder="Ask for pasta under $30…"
                        aria-label="Ask the food assistant"
                        enterKeyHint="send"
                      />
                      {SpeechRecognitionCtor && (
                        <button type="button" className={listening ? 'listening' : ''} onClick={startVoice} aria-label={listening ? 'Listening…' : 'Speak request'} data-testid="mic">
                          <Icon name="mic" />
                        </button>
                      )}
                      <button type="submit" disabled={assistantBusy || !chatInput.trim()} aria-label="Send" data-testid="chat-send">
                        <Icon name="send" />
                      </button>
                    </form>
                  </div>
                </section>
              )}
              <div className="search" role="search">
                <Icon name="search" size={22} />
                <input
                  ref={searchRef}
                  data-testid="search-input"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Restaurant, dish, or cuisine"
                  aria-label="Search restaurants, dishes, or cuisines"
                  type="search"
                />
                <button type="button" onClick={() => (query ? setQuery('') : searchRef.current?.focus())} aria-label={query ? 'Clear search' : 'Go to search'}>
                  {query ? '×' : 'GO'}
                </button>
              </div>
              <div className="filters">
                <button type="button" className="chip selected" onClick={() => setFiltersOpen(true)} data-testid="plan-date-chip" aria-label={`Plan date ${formatShortDate(date)}. Change filters`}>
                  <Icon name="calendar" size={16} />
                  Plan date · {formatShortDate(date)}
                </button>
                <button type="button" className="chip" onClick={() => setFiltersOpen(true)}>
                  {cuisine}
                </button>
                <button type="button" className="chip" onClick={() => setFiltersOpen(true)}>
                  {budget ? `Up to $${budget}` : 'Any budget'}
                </button>
                {assistantPreference && (
                  <button type="button" className="chip assistant" onClick={() => setAssistantPreference(null)} aria-label={`Remove ${assistantPreference} filter`}>
                    {assistantPreference} ×
                  </button>
                )}
                {assistantMaxTravel != null && (
                  <button type="button" className="chip assistant" onClick={() => setAssistantMaxTravel(null)} aria-label={`Remove ${assistantMaxTravel} minute limit`}>
                    ≤ {assistantMaxTravel} min total ×
                  </button>
                )}
              </div>
              <div className="filters areas" data-testid="neighborhoods">
                <button type="button" className={isCitywide(area) ? 'chip selected' : 'chip'} onClick={() => setArea('Seattle, WA')} aria-pressed={isCitywide(area)}>
                  All
                </button>
                {NEIGHBORHOODS.map((name) => (
                  <button type="button" key={name} className={area === name ? 'chip selected' : 'chip'} onClick={() => setArea(name)} aria-pressed={area === name}>
                    {name}
                  </button>
                ))}
              </div>
              <button type="button" className="filter-hero" onClick={() => setFiltersOpen(true)}>
                <span>
                  <Icon name="sliders" />
                  <span>
                    <strong>Plan your meal</strong>
                    <small>Set plan date, cuisine, neighborhood & budget</small>
                  </span>
                </span>
                <Icon name="arrow" />
              </button>
              <div className="transport" role="group" aria-label="Getting there">
                <span>GETTING THERE</span>
                {MODES.map((item) => (
                  <button type="button" key={item.key} className={mode === item.key ? 'active' : ''} onClick={() => setMode(item.key)} aria-pressed={mode === item.key}>
                    <Icon name={item.key} />
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="section-title">
                <div>
                  <p className="eyebrow" data-testid="result-count">
                    {filtered.length} {filtered.length === 1 ? 'PLACE' : 'PLACES'} {isCitywide(area) ? 'IN SEATTLE' : `IN ${area.toUpperCase()}`}
                  </p>
                  <h2>{query ? `Results for “${query}”` : 'Restaurants for you'}</h2>
                </div>
              </div>
              <p className="estimate-note">
                {userLocation ? 'Sorted by straight-line distance from you. ' : ''}Prices, travel, and waits are estimates measured from Pike Place Market. Not
                live traffic. Ratings and waits are sample data; photos are cuisine stand-ins.
              </p>
              <div className="restaurant-list">
                {grouped.map((group, groupIndex) => (
                  <section key={group.name || 'matches'} aria-label={group.name || 'Matching restaurants'}>
                    {group.name && <h3 className="group-label">{group.name.toUpperCase()}</h3>}
                    <div className="restaurant-list">
                      {group.places.map((place, index) => (
                        <ResultCard
                          key={place.id}
                          place={place}
                          mode={mode}
                          eager={groupIndex === 0 && index === 0}
                          saved={saved.includes(place.id)}
                          reason={reasons[place.id]}
                          onSave={() => toggleSave(place.id)}
                          onDetails={() => setDetails(place)}
                          onPlan={() => openSchedule(place)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
              {!filtered.length && (
                <div className="empty" data-testid="empty-results">
                  <Icon name="search" size={32} />
                  <h2>No exact matches</h2>
                  <p>Try another cuisine, neighborhood, or a higher budget.</p>
                  <button type="button" onClick={resetFilters} data-testid="clear-filters">
                    Clear filters
                  </button>
                </div>
              )}
            </>
          )}

          {tab === 'calendar' && (
            <div data-testid="calendar">
              <div className="calendar-head">
                <p className="eyebrow">YOUR DINING CALENDAR</p>
                <h1>Make time for good food.</h1>
                <p>Choose today or a later date, then add a restaurant. Plans are saved to this demo account and do not reserve a table.</p>
              </div>
              <div className="calendar-toolbar">
                <button type="button" aria-label="Previous month" onClick={() => setCalendarMonth(shiftMonth(calendarMonth.year, calendarMonth.month, -1))}>
                  ‹
                </button>
                <h2 data-testid="calendar-month" aria-live="polite">
                  {formatMonthTitle(calendarMonth.year, calendarMonth.month)}
                </h2>
                <button type="button" aria-label="Next month" onClick={() => setCalendarMonth(shiftMonth(calendarMonth.year, calendarMonth.month, 1))}>
                  ›
                </button>
              </div>
              <div className="month-calendar" role="group" aria-label={formatMonthTitle(calendarMonth.year, calendarMonth.month)}>
                {['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map((day) => (
                  <span className="weekday" key={day} aria-hidden="true">
                    {day}
                  </span>
                ))}
                {calendarCells.map((day, index) => {
                  if (!day) return <span className="calendar-day blank" key={`blank-${index}`} />
                  const key = dateKey(day)
                  const dayPlans = plans.filter((plan) => plan.date === key)
                  return (
                    <button
                      type="button"
                      key={key}
                      data-testid="calendar-day"
                      data-date={key}
                      className={key === date ? 'calendar-day selected' : dayPlans.length ? 'calendar-day has-plan' : 'calendar-day'}
                      onClick={() => setDate(key)}
                      aria-pressed={key === date}
                      aria-label={`${formatLongDate(key)}${dayPlans.length ? `, ${dayPlans.length} plan${dayPlans.length === 1 ? '' : 's'}` : ''}`}
                    >
                      <strong>{day}</strong>
                      {dayPlans.slice(0, 2).map((plan) => (
                        <i key={plan.id} aria-hidden="true" data-initial={PLACE_BY_ID.get(plan.placeId)?.name.slice(0, 1)} />
                      ))}
                    </button>
                  )
                })}
              </div>
              <div className="calendar-legend">
                <span>
                  <i /> Restaurant planned
                </span>
                <strong data-testid="plan-total">
                  {plans.length} total plan{plans.length === 1 ? '' : 's'}
                </strong>
              </div>
              <label className="date-picker">
                <span>
                  <Icon name="calendar" />
                  SELECTED DATE
                </span>
                <input
                  type="date"
                  value={date}
                  onChange={(event) => {
                    pickDate(event.target.value)
                    showMonthOf(event.target.value)
                  }}
                  data-testid="calendar-date-input"
                />
              </label>
              <h2 className="chosen-date">Plans for {selectedDate}</h2>
              <button type="button" className="back-discover" onClick={() => setTab('home')}>
                ← Back to restaurants
              </button>
              {userData.plansStatus === 'loading' && !userData.plans.length && (
                <div className="list-status" role="status" data-testid="plans-loading">
                  <span className="spinner" aria-hidden="true" /> Loading your plans…
                </div>
              )}
              {userData.plansStatus === 'error' && (
                <div className="list-status error" role="alert" data-testid="plans-error">
                  <p>Couldn't load your plans. Check the connection and try again.</p>
                  <button type="button" onClick={() => void userData.loadPlans()}>
                    Try again
                  </button>
                </div>
              )}
              {plansForDay.length ? (
                <div className="plan-overview">
                  {plansForDay.map((plan) => {
                    const place = view.find((item) => item.id === plan.placeId)
                    if (!place) return null
                    const isEditing = editing?.id === plan.id
                    return (
                      <article className="planned-card" key={plan.id} data-testid="planned-card" data-plan-id={plan.id}>
                        <PlacePhoto place={place} />
                        <div className="planned-copy">
                          <p>DINING PLAN</p>
                          <h3>{place.name}</h3>
                          <span>{formatWhen(plan.date, plan.time)}</span>
                          <small>
                            ${place.serving}/person · {place.travel + place.wait} min total by {mode === 'car' ? 'car' : mode}
                          </small>
                        </div>
                        <Icon name="check" />
                        {isEditing && editing ? (
                          <div className="edit-panel">
                            <label>
                              Change date
                              <input
                                type="date"
                                min={plan.date < today ? plan.date : today}
                                value={editing.date}
                                onChange={(event) => isValidDateString(event.target.value) && setEditing({ ...editing, date: event.target.value })}
                                data-testid="edit-date"
                              />
                            </label>
                            <label>
                              Arrival time
                              <input
                                type="time"
                                value={editing.time}
                                onChange={(event) => isValidTimeString(event.target.value) && setEditing({ ...editing, time: event.target.value })}
                                data-testid="edit-time"
                              />
                            </label>
                            {editError && (
                              <p className="form-error" role="alert" data-testid="edit-error">
                                {editError}
                              </p>
                            )}
                            <div>
                              <button type="button" onClick={() => void saveEdit()} disabled={editBusy} data-testid="edit-save">
                                {editBusy ? 'Saving…' : 'Save changes'}
                              </button>
                              <button type="button" onClick={() => setEditing(null)} disabled={editBusy}>
                                Cancel
                              </button>
                              <button type="button" className="remove" onClick={() => void removePlan(plan)} disabled={editBusy} data-testid="edit-remove">
                                Remove plan
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="edit-plan"
                            onClick={() => {
                              setEditError('')
                              setEditing({ id: plan.id, date: plan.date, time: plan.time })
                            }}
                            data-testid="edit-plan"
                          >
                            View or edit plan
                          </button>
                        )}
                      </article>
                    )
                  })}
                  <button type="button" className="add-another" onClick={() => setTab('home')}>
                    <Icon name="plus" /> Add another restaurant
                  </button>
                </div>
              ) : (
                userData.plansStatus !== 'error' && (
                  <div className="empty calendar-empty" data-testid="calendar-empty">
                    <Icon name="calendar" size={32} />
                    <h2>No meal on this date</h2>
                    <p>Select a marked date to see its restaurant, or plan a new meal.</p>
                    <button type="button" onClick={() => setTab('home')}>
                      Find a restaurant
                    </button>
                  </div>
                )
              )}
              {upcomingElsewhere.length > 0 && (
                <div className="upcoming" data-testid="upcoming-plans">
                  <h3>Other upcoming plans</h3>
                  {upcomingElsewhere.map((plan) => (
                    <button
                      type="button"
                      key={plan.id}
                      data-testid="upcoming-plan"
                      onClick={() => {
                        pickDate(plan.date)
                        showMonthOf(plan.date)
                      }}
                    >
                      <strong>{PLACE_BY_ID.get(plan.placeId)?.name ?? 'Restaurant'}</strong>
                      <span>
                        {formatShortDate(plan.date)} · {formatTime(plan.time)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'heart' && (
            <div data-testid="saved">
              <div className="simple-page">
                <p className="eyebrow">YOUR COLLECTION</p>
                <h1>Saved places</h1>
                <p>{saved.length ? `${saved.length} restaurant${saved.length > 1 ? 's' : ''} saved to this demo account.` : 'Restaurants you love will appear here.'}</p>
              </div>
              {userData.savedStatus === 'loading' && !saved.length && (
                <div className="list-status" role="status" data-testid="saved-loading">
                  <span className="spinner" aria-hidden="true" /> Loading saved places…
                </div>
              )}
              {userData.savedStatus === 'error' && (
                <div className="list-status error" role="alert" data-testid="saved-error">
                  <p>Couldn't load your saved places. Check the connection and try again.</p>
                  <button type="button" onClick={() => void userData.loadSaved()}>
                    Try again
                  </button>
                </div>
              )}
              <div className="restaurant-list saved-list">
                {view
                  .filter((place) => saved.includes(place.id))
                  .map((place) => (
                    <article className="saved-row" key={place.id} data-testid="saved-row" data-place-id={place.id}>
                      <PlacePhoto place={place} />
                      <div>
                        <span>{place.cuisine}</span>
                        <h3>{place.name}</h3>
                        <p>
                          {place.neighborhood} · {place.price} · {place.travel + place.wait} min total
                        </p>
                      </div>
                      <button type="button" onClick={() => toggleSave(place.id)} aria-label={`Remove ${place.name} from saved`}>
                        <Icon name="heart" filled />
                      </button>
                    </article>
                  ))}
              </div>
              {!saved.length && userData.savedStatus === 'ready' && (
                <div className="empty" data-testid="saved-empty">
                  <Icon name="heart" size={32} />
                  <h2>Nothing saved yet</h2>
                  <button type="button" onClick={() => setTab('home')}>
                    Explore restaurants
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === 'user' && (
            <div className="simple-page profile" data-testid="profile">
              <div className="profile-avatar" aria-hidden="true">
                {DEMO_USER.initials}
              </div>
              <h1>{DEMO_USER.name}</h1>
              <p>Demo profile. There is no sign-in in this version.</p>
              <div className="preference">
                <label htmlFor="profile-area">Current area</label>
                <div className="control">
                  <Icon name="pin" />
                  <select id="profile-area" value={profileArea} onChange={(event) => setArea(event.target.value)} data-testid="profile-area">
                    <option value="Seattle, WA">All of Seattle</option>
                    {NEIGHBORHOODS.map((name) => (
                      <option value={name} key={name}>
                        {name}
                      </option>
                    ))}
                    {profileAreaIsCustom && <option value={profileArea}>{profileArea}</option>}
                  </select>
                </div>
              </div>
              <div className="preference">
                <label htmlFor="profile-budget">Maximum budget</label>
                <div className="control">
                  <strong aria-hidden="true">$</strong>
                  <input
                    id="profile-budget"
                    type="number"
                    min="1"
                    inputMode="numeric"
                    value={budget}
                    onChange={(event) => setBudget(event.target.value.replace(/[^\d]/g, '').slice(0, 4))}
                    placeholder="No limit"
                    data-testid="profile-budget"
                  />
                  {budget && (
                    <button type="button" className="control-clear" onClick={() => setBudget('')} aria-label="Remove budget limit" data-testid="profile-budget-clear">
                      <Icon name="close" size={16} />
                    </button>
                  )}
                </div>
                <small>Per person. Leave empty for no limit.</small>
              </div>
              <div className="preference" role="group" aria-labelledby="profile-travel-label">
                <span id="profile-travel-label">Travel preference</span>
                <div className="option-grid">
                  {MODES.map((item) => (
                    <button type="button" key={item.key} className={mode === item.key ? 'active' : ''} onClick={() => setMode(item.key)} aria-pressed={mode === item.key} data-testid={`profile-mode-${item.key}`}>
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <button type="button" className="preference link" onClick={() => setTab('heart')} data-testid="profile-saved-link">
                <span>Saved places</span>
                <strong>
                  {saved.length} place{saved.length === 1 ? '' : 's'}
                </strong>
              </button>
              <button type="button" className="preference link" onClick={() => setTab('calendar')} data-testid="profile-plans-link">
                <span>Dining plans</span>
                <strong>
                  {plans.length} plan{plans.length === 1 ? '' : 's'}
                </strong>
              </button>
              {/* Setup status is for whoever runs the app. It follows the server's AI_KEY_PROMPT setting, so a demo audience never sees it. */}
              {ai.keyPromptEnabled &&
                (ai.state === 'missing-key' ? (
                  <button type="button" className="preference link" onClick={() => setKeyPrompt({ pending: null })} data-testid="profile-ai">
                    <span>AI assistant</span>
                    <strong>Off: add API key</strong>
                    <small>No key yet, so answers use basic keyword matching.</small>
                  </button>
                ) : ai.state === 'ready' || ai.state === 'server-offline' ? (
                  <div className="preference" data-testid="profile-ai">
                    <span>AI assistant</span>
                    <strong>{ai.state === 'ready' ? 'On' : 'Off: server not running'}</strong>
                    <small>{ai.state === 'ready' ? 'Answers come from the live model. To change the key, edit server/.env.' : 'Start the app server to use AI.'}</small>
                  </div>
                ) : null)}
              <p className="profile-note">Area, budget and travel changes apply to Discover.</p>
            </div>
          )}
        </div>
        {userData.savedError && (
          <div className="toast" role="alert" data-testid="saved-toast">
            <span>{userData.savedError}</span>
            <button type="button" onClick={userData.clearSavedError} aria-label="Dismiss message">
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        <Nav tab={tab} setTab={setTab} />

        {filtersOpen && (
          <FilterSheet onClose={() => setFiltersOpen(false)}>
            <div className="sheet-title">
              <div>
                <p className="eyebrow">REFINE YOUR SEARCH</p>
                <h2 id="filters-title">Filters</h2>
              </div>
              <button type="button" onClick={() => setFiltersOpen(false)} aria-label="Close filters">
                <Icon name="close" />
              </button>
            </div>
            <label className="field">
              <span>Area</span>
              <div>
                <Icon name="pin" />
                <input value={area} onChange={(event) => setArea(event.target.value)} placeholder="City or neighborhood" />
              </div>
            </label>
            <fieldset>
              <legend>Neighborhood</legend>
              <div className="option-grid areas">
                <button type="button" className={isCitywide(area) ? 'active' : ''} onClick={() => setArea('Seattle, WA')} aria-pressed={isCitywide(area)}>
                  All
                </button>
                {NEIGHBORHOODS.map((name) => (
                  <button type="button" className={area === name ? 'active' : ''} onClick={() => setArea(name)} key={name} aria-pressed={area === name}>
                    {name}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="field">
              <span>Plan date</span>
              <div>
                <Icon name="calendar" />
                <input type="date" min={today} value={date} onChange={(event) => pickDate(event.target.value)} data-testid="filter-date" />
              </div>
              <small className="field-hint">Used when you add a restaurant to your calendar. It does not hide any restaurants.</small>
            </label>
            <fieldset>
              <legend>Food type</legend>
              <div className="option-grid">
                {['All food', ...CUISINES].map((name) => (
                  <button type="button" className={cuisine === name ? 'active' : ''} onClick={() => setCuisine(name)} key={name} aria-pressed={cuisine === name}>
                    {name}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="field">
              <span>Maximum budget per person</span>
              <div>
                <strong aria-hidden="true">$</strong>
                <input
                  type="number"
                  min="1"
                  inputMode="numeric"
                  value={budget}
                  onChange={(event) => setBudget(event.target.value.replace(/[^\d]/g, '').slice(0, 4))}
                  placeholder="Enter amount, e.g. 35"
                  data-testid="budget-input"
                />
              </div>
              <small className="field-hint">Only places with an estimated serving at or below this amount appear.</small>
            </label>
            <button
              type="button"
              className="apply"
              onClick={() => {
                setFiltersOpen(false)
                setTab('home')
              }}
              data-testid="apply-filters"
            >
              Show {filtered.length} restaurants
            </button>
            <button type="button" className="reset" onClick={resetFilters} data-testid="reset-filters">
              Reset all filters
            </button>
          </FilterSheet>
        )}

        {schedulePlace && (
          <Modal onClose={() => !scheduleSaving && setSchedulePlace(null)} className="schedule-card" label="Create a dining plan" testId="schedule">
            <div className="sheet-title">
              <div>
                <p className="eyebrow">CREATE A DINING PLAN</p>
                <h2>When would you like to go?</h2>
              </div>
              <button type="button" onClick={() => setSchedulePlace(null)} aria-label="Close scheduling" disabled={scheduleSaving}>
                <Icon name="close" />
              </button>
            </div>
            <div className="schedule-restaurant">
              <PlacePhoto place={schedulePlace} />
              <div>
                <strong>{schedulePlace.name}</strong>
                <span>
                  {schedulePlace.neighborhood} · ${schedulePlace.serving}/person
                </span>
              </div>
            </div>
            <label className="field">
              <span>Date</span>
              <div>
                <Icon name="calendar" />
                <input type="date" min={today} value={date} onChange={(event) => pickDate(event.target.value)} data-testid="schedule-date" />
              </div>
            </label>
            <label className="field">
              <span>Preferred arrival time</span>
              <div>
                <Icon name="clock" />
                <input data-testid="schedule-time" type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} data-autofocus />
              </div>
            </label>
            <div className="plan-summary">
              <strong>Plan summary</strong>
              <span>{schedulePlace.name}</span>
              <span>{scheduleTime ? formatWhen(date, scheduleTime) : selectedDate}</span>
              <small>This saves a personal dining plan. It does not reserve a table.</small>
            </div>
            {scheduleError && (
              <p className="form-error" role="alert" data-testid="schedule-error">
                {scheduleError}
              </p>
            )}
            <button
              type="button"
              className="continue-btn"
              data-testid="save-plan"
              disabled={!isValidDateString(date) || !isValidTimeString(scheduleTime) || scheduleSaving}
              onClick={() => void confirmPlan()}
            >
              {scheduleSaving ? 'Saving…' : 'Save Dining Plan'}
            </button>
          </Modal>
        )}

        {details && (
          <Modal onClose={() => setDetails(null)} className="detail-card" labelledBy="details-title" testId="details" closeOnBackdrop>
            <PlacePhoto place={details} eager />
            <button type="button" className="detail-close" onClick={() => setDetails(null)} aria-label="Close details">
              <Icon name="close" />
            </button>
            <div>
              <p className="eyebrow">
                {details.cuisine} · {details.neighborhood}
              </p>
              <h2 id="details-title">{details.name}</h2>
              <p className="address-line">
                <Icon name="pin" size={14} />
                {details.address}
              </p>
              <p>{details.note}</p>
              <div className="detail-facts">
                <span>
                  <strong>${details.serving}</strong> per person
                </span>
                <span>
                  <strong>{details.rating ?? '—'}</strong> {details.rating ? 'public rating' : 'no public score'}
                </span>
                <span>
                  <strong>{details.travel + details.wait} min</strong> est. total
                </span>
              </div>
              <p className="fine-print">
                The photo is a stand-in for the cuisine, not a picture of this restaurant. Prices, travel, and wait times are estimates. Adding it to
                the calendar does not reserve a table.
              </p>
              <button
                type="button"
                className="continue-btn"
                onClick={() => {
                  const place = details
                  setDetails(null)
                  openSchedule(place)
                }}
                data-testid="details-plan"
              >
                Add to calendar
              </button>
            </div>
          </Modal>
        )}

        {keyPrompt && <AiKeyPrompt state={ai.state} onReady={() => closeKeyPrompt(true)} onSkip={() => closeKeyPrompt(false)} />}

        {confirmation && (
          <Modal onClose={() => setConfirmation(null)} className="confirmation-card" label="Dining plan saved" testId="confirmation">
            <span className="success-icon">
              <Icon name="check" size={28} />
            </span>
            <p className="eyebrow">DINING PLAN SAVED</p>
            <h2>Restaurant added</h2>
            <p className="confirmation-copy">Your restaurant visit has been added to your calendar. No table reservation was made.</p>
            <div className="confirmation-detail">
              <PlacePhoto place={confirmation.place} />
              <div>
                <strong>{confirmation.place.name}</strong>
                <span>
                  <Icon name="calendar" size={15} />
                  {formatWhen(confirmation.date)}
                </span>
                <small>
                  {formatTime(confirmation.time)} · ${confirmation.place.serving}/person
                </small>
              </div>
            </div>
            <button
              type="button"
              className="continue-btn"
              onClick={() => {
                showMonthOf(confirmation.date)
                setDate(confirmation.date)
                setConfirmation(null)
                setTab('calendar')
              }}
              data-testid="go-to-calendar"
            >
              Continue to my calendar <Icon name="arrow" />
            </button>
            <button type="button" className="keep-browsing" onClick={() => setConfirmation(null)}>
              Keep browsing
            </button>
          </Modal>
        )}
      </section>
    </main>
  )
}
