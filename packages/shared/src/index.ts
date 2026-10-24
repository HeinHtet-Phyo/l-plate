// Types shared by web and server. Types only: no runtime code.

// ---------- Routes ----------

export type StepType =
  | 'depart'
  | 'turn'
  | 'new name'
  | 'continue'
  | 'end of road'
  | 'fork'
  | 'merge'
  | 'roundabout'
  | 'rotary'
  | 'roundabout turn'
  | 'arrive';

export type Modifier =
  | 'left'
  | 'right'
  | 'slight left'
  | 'slight right'
  | 'sharp left'
  | 'sharp right'
  | 'straight'
  | 'uturn';

export interface RouteStep {
  type: StepType;
  modifier?: Modifier;
  exit?: number;
  road: string;
  location: { lat: number; lng: number };
  /** Metres along the path. */
  at: number;
  instruction: string;
}

export interface SpeedLimitSpan {
  from: number;
  to: number;
  mph: number;
}

export interface RoutedPath {
  path: { lat: number; lng: number }[];
  distance: number;
  duration: number;
  steps: RouteStep[];
}

export interface TestRoute extends RoutedPath {
  id: string;
  name: string;
  summary: string;
  features: string[];
  centre: { name: string; address: string; postcode: string; lat: number; lng: number };
  start: { lat: number; lng: number; heading: number };
  waypoints: [number, number][];
  speedLimits: SpeedLimitSpan[];
  pathHash?: string;
}

export interface FreeStart {
  id: string;
  name: string;
  area: string;
  lat: number;
  lng: number;
  heading: number;
  note: string;
}

// ---------- Phone protocol ----------

export type Role = 'host' | 'controller';

export interface PairResponse {
  sessionId: string;
  hostToken: string;
  controllerToken: string;
}

export type PhoneCommand = 'indicator-left' | 'indicator-right' | 'handbrake' | 'recover' | 'reverse';
export type Gear = 'D' | 'R';
export type SensorStatus = 'ok' | 'flat' | 'denied' | 'unavailable';
export type Indicator = 'off' | 'left' | 'right';

export type ControllerMessage =
  | { type: 'controls'; steer: number; throttle: number; brake: number }
  | { type: 'command'; command: PhoneCommand }
  | { type: 'sensor'; status: SensorStatus }
  | { type: 'ping' };

export type HostMessage =
  | {
      type: 'state';
      indicator: Indicator;
      indicatorLit: boolean;
      handbrake: boolean;
      speedMph: number;
      driving: boolean;
      gear: Gear;
    }
  /** A fault just happened: the phone buzzes (long for serious) and flashes it. */
  | { type: 'fault'; category: string; text: string; serious: boolean }
  /** The lesson's debrief, shown on the phone as a report card. */
  | {
      type: 'report';
      result: 'pass' | 'fail';
      summary: string;
      faults: { category: string; severity: Severity; count: number }[];
      source: 'nebius' | 'offline';
    }
  | { type: 'ping' };

export type ServerMessage =
  | { type: 'peer'; connected: boolean }
  | { type: 'error'; message: string }
  | { type: 'replaced' }
  | { type: 'pong' };

export interface AppConfig {
  publicUrl: string | null;
  lanUrls: string[];
  instructor: boolean;
}

// ---------- Instructor ----------

export interface ChatTurn {
  role: 'instructor' | 'learner';
  text: string;
}

export interface DrivingStatus {
  speedMph: number;
  limitMph: number | null;
  road: string;
  indicator: Indicator;
  handbrake: boolean;
  nextInstruction: string | null;
  distanceToNext: string | null;
  faultsSoFar: number;
}

export interface InstructorRequest {
  sessionId: string;
  turns: ChatTurn[];
  sim: string[];
  status: DrivingStatus;
}

export type Severity = 'driving' | 'serious' | 'dangerous';

export interface FaultRecord {
  kind: string;
  category: string;
  text: string;
  road: string;
  time: number;
}

export interface DebriefRequest {
  route: string;
  faults: FaultRecord[];
  stats: {
    distance: number;
    duration: number;
    maxSpeedOverLimit: number;
    [k: string]: number;
  };
}

export interface Debrief {
  result: 'pass' | 'fail';
  summary: string;
  faults: { category: string; severity: Severity; count: number; advice: string }[];
  focusNext: string[];
  source: 'nebius' | 'offline';
  /** The model's own verdict, when it disagreed with the DVSA rule. */
  modelResult?: 'pass' | 'fail';
  rules?: { rule: string; text: string }[];
}

export interface RuleHit {
  rule: string;
  title: string;
  text: string;
  score: number;
}

// ---------- Model referee ----------

/** The same drive log sent to several examiner models, scored against the DVSA rule. */
export interface RefereeRequest extends DebriefRequest {
  models?: string[];
}

export interface RefereeChecks {
  /** The reply parsed as JSON and matched the debrief schema. */
  validJson: boolean;
  /** The model's own PASS/FAIL. */
  verdict: 'pass' | 'fail' | null;
  /** Its verdict equals the rule-based reference for this fault log. */
  verdictMatchesRule: boolean;
  /** Its verdict follows the DVSA rule applied to its own severities. */
  selfConsistent: boolean;
  faultCountModel: number;
  faultCountLog: number;
  /** "Rule N" citations that aren't in the Highway Code (307 rules). */
  inventedRules: string[];
  citedRules: string[];
}

export interface RefereeEntry {
  model: string;
  ok: boolean;
  error?: string;
  ms: number;
  tokens: { prompt: number; completion: number } | null;
  /** The model's raw debrief, before the server's guards rewrite it. */
  debrief: Omit<Debrief, 'source'> | null;
  checks: RefereeChecks;
  /** 0–100: valid JSON, right verdict, self-consistent, counts match, no invented rules. */
  score: number;
}

export interface RefereeResponse {
  /** Rule-based verdict for this fault log: the ground truth. */
  reference: 'pass' | 'fail';
  faultCount: number;
  entries: RefereeEntry[];
}
