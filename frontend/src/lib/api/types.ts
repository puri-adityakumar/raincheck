/** Public API types matching backend/app/schemas/. Keep field names stable. */

export type Relationship = 'friend' | 'group' | 'coworker' | 'family' | 'date' | 'neighbor' | 'other';
export type Tone = 'honest' | 'cozy' | 'theatrical';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown> | null;
    request_id: string;
  };
}

export interface ProposedTime {
  date: string; // YYYY-MM-DD
  start_time: string; // HH:MM
  end_time: string | null;
  timezone: string; // IANA
  location_label: string | null;
}

export interface HealthResponse {
  status: 'ok';
  service: 'raincheck-api';
  version: string;
  time: string;
  database: 'ok';
  capabilities: {
    weather: boolean;
    tickets: boolean;
    ai_generation: boolean;
    ai_provider: 'none' | 'tinker';
    paid_training_enabled: boolean;
  };
}

export interface LocationResult {
  id: string;
  name: string;
  admin1: string | null;
  country: string;
  country_code: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export interface LocationsResponse {
  query: string;
  results: LocationResult[];
  attribution: { text: string; url: string };
}

export interface WeatherResponse {
  date: string;
  location: {
    label: string;
    name: string;
    admin1: string | null;
    country: string;
    country_code: string;
    timezone: string;
  };
  forecast: {
    weather_code: number;
    condition: string;
    temperature_min_c: number;
    temperature_max_c: number;
    precipitation_probability_max: number | null;
    precipitation_sum_mm: number | null;
    wind_speed_max_kmh: number | null;
  };
  summary: string;
  grounded: true;
  is_forecast: boolean;
  source: {
    provider: 'open-meteo';
    endpoint: string;
    model: string;
    fetched_at: string;
  };
  attribution: { text: string; url: string };
  weather_token: string;
}

export interface GenerateRequest {
  recipient: { relationship: Relationship; display_name?: string | null };
  tone: Tone;
  plan?: { title?: string | null; details?: string | null };
  context?: string | null;
  proposed: ProposedTime;
  weather_token?: string | null;
  sender_name?: string | null;
}

export interface GenerateResponse {
  generation_id: string;
  message: string;
  tone: Tone;
  labels: {
    is_ai_generated: boolean;
    is_sample: boolean;
    theatrical: boolean;
    availability_confirmed: false;
  };
  review_required: true;
  max_length: number;
  disclosures: string[];
  created_at: string;
}

export interface CreateTicketRequest {
  message: string;
  recipient: { relationship: Relationship; display_name?: string | null };
  tone: Tone;
  plan?: { title?: string | null; details?: string | null };
  proposed: ProposedTime;
  weather_token?: string | null;
  sender_name?: string | null;
  reviewed: true;
}

export interface CreateTicketResponse {
  ticket_id: string;
  token: string;
  share_path: string;
  accept_path: string;
  ics_path: string;
  status: 'open';
  created_at: string;
  expires_at: string;
  proposed: ProposedTime;
  labels: { theatrical: boolean; availability_confirmed: false };
}

export interface WeatherSnapshot {
  date: string;
  weather_code: number;
  condition: string;
  summary: string;
  temperature_min_c: number;
  temperature_max_c: number;
  precipitation_probability_max: number | null;
  source: 'open-meteo';
  fetched_at: string;
  attribution: { text: string; url: string };
}

export interface TicketResponse {
  ticket_id: string;
  status: 'open' | 'accepted';
  message: string;
  sender_name: string | null;
  recipient: { relationship: Relationship; display_name: string | null };
  tone: Tone;
  theatrical: boolean;
  plan: { title: string | null; details: string | null };
  proposed: ProposedTime;
  weather: WeatherSnapshot | null;
  availability: { confirmed: false; note: string };
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

export interface AcceptResponse {
  ticket_id: string;
  status: 'accepted';
  accepted_at: string;
  already_accepted: boolean;
}
