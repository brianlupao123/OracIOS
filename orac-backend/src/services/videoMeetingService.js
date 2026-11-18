// backend/src/services/videoMeetingService.js
//
// WebRTC Video Room Integration for Virtual Technical Surveys.
// Harvested from MediVital Daily.co video service patterns.
// Supports CAD screen sharing, participant token generation, and deterministic offline mock fallback.

const DAILY_API_KEY = process.env.DAILY_API_KEY || "";
const DAILY_API_URL = "https://api.daily.co/v1";

/**
 * Provisions a WebRTC meeting room for technical equipment consultation.
 * 
 * @param {string} surveyId 
 * @param {string} roomName 
 * @param {number} durationMinutes 
 * @returns {Promise<{ room_name: string, room_url: string, is_mock: boolean }>}
 */
export async function provisionDailyRoom(surveyId, roomName = "", durationMinutes = 60) {
  const cleanName = (roomName || `orac-survey-${surveyId}-${Date.now()}`).toLowerCase().replace(/[^a-z0-9_-]/g, "-");

  // In test or non-production environments without active key, return verified deterministic mock
  if (!DAILY_API_KEY) {
    return {
      room_name: cleanName,
      room_url: `https://orac-systems.daily.co/${cleanName}`,
      is_mock: true
    };
  }

  try {
    const expTime = Math.floor(Date.now() / 1000) + (durationMinutes * 60) + 1800; // +30m grace
    const response = await fetch(`${DAILY_API_URL}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DAILY_API_KEY}`
      },
      body: JSON.stringify({
        name: cleanName,
        privacy: "private",
        properties: {
          exp: expTime,
          enable_screenshare: true,
          enable_chat: true,
          start_audio_off: false,
          start_video_off: false
        }
      })
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(`Daily.co room provisioning failed (${response.status}): ${errBody.info || response.statusText}`);
    }

    const data = await response.json();
    return {
      room_name: data.name,
      room_url: data.url,
      is_mock: false
    };
  } catch (err) {
    // Graceful offline fallback
    return {
      room_name: cleanName,
      room_url: `https://orac-systems.daily.co/${cleanName}`,
      is_mock: true,
      fallback_reason: err.message
    };
  }
}

/**
 * Generates participant access token with configured permissions (Host vs Client Engineer).
 */
export async function generateMeetingToken(roomName, userName, isOwner = false) {
  if (!DAILY_API_KEY) {
    return {
      token: `mock-token-${isOwner ? "host" : "guest"}-${Date.now()}`,
      room_name: roomName,
      user_name: userName,
      is_owner: isOwner,
      is_mock: true
    };
  }

  try {
    const expTime = Math.floor(Date.now() / 1000) + 7200; // 2 hours
    const response = await fetch(`${DAILY_API_URL}/meeting-tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DAILY_API_KEY}`
      },
      body: JSON.stringify({
        properties: {
          room_name: roomName,
          user_name: userName,
          is_owner: isOwner,
          exp: expTime,
          enable_screenshare: true
        }
      })
    });

    if (!response.ok) {
      return {
        token: `mock-token-${isOwner ? "host" : "guest"}-${Date.now()}`,
        room_name: roomName,
        user_name: userName,
        is_owner: isOwner,
        is_mock: true
      };
    }

    const data = await response.json();
    return {
      token: data.token,
      room_name: roomName,
      user_name: userName,
      is_owner: isOwner,
      is_mock: false
    };
  } catch {
    return {
      token: `mock-token-${isOwner ? "host" : "guest"}-${Date.now()}`,
      room_name: roomName,
      user_name: userName,
      is_owner: isOwner,
      is_mock: true
    };
  }
}
