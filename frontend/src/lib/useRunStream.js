import { useEffect, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const WS_BASE = API_BASE.replace(/^http/, "ws");

const RECONNECT_DELAY_MS = 1500;
const MAX_RECONNECT_ATTEMPTS = 8; // ~12s of retrying before giving up

/** Opens ws://.../stream/:runId on mount, closes on unmount. Stays open
 * across an approve -> resume cycle (the backend keeps publishing to the
 * same run_id's queue), so no reconnect logic is needed for that flow.
 *
 * A dropped connection (server killed, network blip) DOES need handling -
 * the raw WebSocket API gives no retry for free. Reconnects with a fixed
 * delay, capped, and reports connection state so the caller can show
 * something better than a silently frozen step tracker.
 *
 * Returns "connected" | "reconnecting" | "disconnected" | "not_found".
 */
export function useRunStream(runId, onMessage) {
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;
  const [status, setStatus] = useState("connected");

  useEffect(() => {
    if (!runId) return;

    let attempts = 0;
    // Plain closure flags, not React state: onclose fires in this same
    // closure and needs the CURRENT value synchronously. Reading `status`
    // (state) here would capture whatever it was when this effect ran,
    // not what it's been set to since - a stale-closure bug.
    let stopRetrying = false;
    let retryTimer = null;
    let ws = null;

    function connect() {
      ws = new WebSocket(`${WS_BASE}/stream/${runId}`);

      ws.onopen = () => {
        attempts = 0;
        setStatus("connected");
      };

      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return; // malformed frame - ignore rather than crash the stream
        }
        if (msg.stage === "error") {
          stopRetrying = true;
          setStatus("not_found");
          return;
        }
        handlerRef.current(msg);
        if (msg.stage === "completed" || msg.stage === "failed") {
          stopRetrying = true; // the backend closes right after these anyway
        }
      };

      ws.onclose = () => {
        if (stopRetrying) return;
        if (attempts >= MAX_RECONNECT_ATTEMPTS) {
          setStatus("disconnected");
          return;
        }
        attempts += 1;
        setStatus("reconnecting");
        retryTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    }

    connect();
    return () => {
      stopRetrying = true;
      clearTimeout(retryTimer);
      // Closing a socket still in CONNECTING state logs a benign but noisy
      // browser console warning ("WebSocket is closed before the connection
      // is established"). Deferring the close until it actually opens avoids
      // that - the socket still never outlives the component.
      if (ws && ws.readyState === WebSocket.CONNECTING) {
        ws.addEventListener("open", () => ws.close());
      } else {
        ws?.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  return status;
}
