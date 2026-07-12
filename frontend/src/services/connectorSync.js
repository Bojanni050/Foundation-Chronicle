import { getSettings } from "@/lib/settings";

const { apiUrl } = getSettings();

async function api(path, options = {}) {
  const { apiUrl } = getSettings();
  const res = await fetch(`${apiUrl}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/** List all configured connectors */
export async function getConnectors() {
  try {
    return await api("/connectors");
  } catch {
    return [];
  }
}

/** List available connector types */
export async function getConnectorTypes() {
  try {
    return await api("/connectors/types");
  } catch {
    return [];
  }
}

/** Create a new connector */
export async function createConnector(type, label, config) {
  return api("/connectors", {
    method: "POST",
    body: JSON.stringify({ type, label, config }),
  });
}

/** Update a connector (label/config) */
export async function updateConnector(id, patch) {
  return api(`/connectors/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** Delete a connector */
export async function deleteConnector(id) {
  return api(`/connectors/${id}`, { method: "DELETE" });
}

/** Test connection to external service */
export async function testConnector(id) {
  return api(`/connectors/${id}/test`, { method: "POST" });
}

/** Sync data from external service */
export async function syncConnector(id) {
  return api(`/connectors/${id}/sync`, { method: "POST" });
}