// Daily rooms and participant tokens for Virtual Technical Surveys.
const DAILY_API_URL = "https://api.daily.co/v1";
const ROOM_GRACE_MS = 30 * 60 * 1000;

export function surveyStartMs(value) {
  if (typeof value !== "string") return NaN;
  // Older portal datetime-local values represent the ORAC business timezone.
  const localTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value);
  return Date.parse(localTime ? value + "+02:00" : value);
}

export function meetingEndMs(scheduledAt, durationMinutes) {
  return surveyStartMs(scheduledAt) + durationMinutes * 60_000 + ROOM_GRACE_MS;
}

function unavailable() {
  return Object.assign(new Error("Video conferencing is temporarily unavailable."), { statusCode: 503 });
}

async function dailyRequest(path, body) {
  try {
    const response = await fetch(DAILY_API_URL + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + process.env.DAILY_API_KEY
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000)
    });
    if (response.ok) return await response.json();
  } catch {
    // Provider errors may include private details.
  }
  throw unavailable();
}

function useLocalMock() {
  if (process.env.DAILY_API_KEY) return false;
  if (process.env.NODE_ENV === "production") throw unavailable();
  return true;
}

export async function provisionDailyRoom(surveyId, roomName = "", durationMinutes = 60, scheduledAt) {
  const cleanName = (roomName || "orac-survey-" + surveyId).toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  if (useLocalMock()) {
    return { room_name: cleanName, room_url: null, is_mock: true };
  }

  const end = meetingEndMs(scheduledAt, durationMinutes);
  if (!Number.isFinite(end)) throw unavailable();
  const data = await dailyRequest("/rooms", {
    name: cleanName,
    privacy: "private",
    properties: {
      exp: Math.floor(end / 1000),
      enable_knocking: false,
      enable_screenshare: true,
      enable_chat: true
    }
  });
  if (data?.name !== cleanName || typeof data?.url !== "string") throw unavailable();
  return { room_name: data.name, room_url: data.url, is_mock: false };
}

export async function generateMeetingToken(roomName, userName, isOwner = false, roomEndsAt = Infinity) {
  if (!roomName) throw unavailable();
  if (useLocalMock()) {
    return {
      token: "mock-token-" + (isOwner ? "host-" : "guest-") + Date.now(),
      room_name: roomName, user_name: userName, is_owner: isOwner, is_mock: true
    };
  }

  const expiry = Math.min(Date.now() + 2 * 60 * 60_000, roomEndsAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw unavailable();
  const data = await dailyRequest("/meeting-tokens", {
    properties: {
      room_name: roomName,
      user_name: userName,
      is_owner: isOwner,
      exp: Math.floor(expiry / 1000),
      enable_screenshare: true
    }
  });
  if (typeof data?.token !== "string" || !data.token) throw unavailable();
  return { token: data.token, room_name: roomName, user_name: userName, is_owner: isOwner, is_mock: false };
}
