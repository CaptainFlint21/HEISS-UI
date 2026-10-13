import { useSyncExternalStore } from 'react';
import { apiJson } from './api';
import type { NodePackInfo, PackAutoInstall, ShellPlan } from './types';

/**
 * HEISS UI Nodes, HEISS's own ComfyUI pack (docs/heiss-nodes.md,
 * server/heiss-nodes.js), as one thing the app installs and keeps current.
 * A feature that runs on it calls requireHeissNodes(feature, then): when the
 * pack is loaded and new enough, `then` runs straight away; otherwise the
 * HEISS Nodes dialog opens, installs or updates the whole pack, waits for the
 * ComfyUI restart, and runs `then` once the feature is ready.
 */
export type HeissNodesState = 'install' | 'update' | 'restart' | 'ready';

export type HeissNodesFeature = { id: string; label: string; blurb: string; version: number; nvidia: boolean; ready: boolean };

export type HeissNodesStatus = {
  state: HeissNodesState;
  requiredVersion: number;
  loadedVersion: number;
  diskVersion: number | null;
  local: { present: boolean; git: boolean; onPin: boolean } | null;
  features: HeissNodesFeature[];
  setup?: ShellPlan & { pack: NodePackInfo; manager?: boolean; autoInstall?: PackAutoInstall; exact?: boolean; cloned?: boolean; needsGit?: boolean; customNodesDir?: string; python?: string };
};

type Request = { feature: string; then?: () => void };

type Store = { status: HeissNodesStatus | null; offline: boolean; checkedAt: number; request: Request | null };

let store: Store = { status: null, offline: false, checkedAt: 0, request: null };
const listeners = new Set<() => void>();
const readyListeners = new Set<() => void>();

function set(patch: Partial<Store>) {
  store = { ...store, ...patch };
  listeners.forEach((listener) => listener());
}

export async function loadHeissNodes({ fresh = false } = {}): Promise<HeissNodesStatus | null> {
  try {
    const status = await apiJson<HeissNodesStatus>(`/api/heiss-nodes${fresh ? '?fresh=1' : ''}`);
    const wasReady = store.status?.state === 'ready';
    set({ status, offline: false, checkedAt: Date.now() });
    // Newly ready: whatever lists capabilities (models' Rapid, RTX) asks again.
    if (status.state === 'ready' && !wasReady) readyListeners.forEach((listener) => listener());
    return status;
  } catch {
    set({ offline: true, checkedAt: Date.now() });
    return null;
  }
}

export function featureReady(status: HeissNodesStatus | null, feature: string) {
  return Boolean(status?.features.find((item) => item.id === feature)?.ready);
}

/**
 * Before a feature that needs the pack: runs `then` when it is ready, else
 * opens the dialog for it. Checks afresh, so a pack installed a moment ago
 * (or by hand) counts.
 */
export async function requireHeissNodes(feature: string, then?: () => void) {
  const status = await loadHeissNodes({ fresh: true });
  if (status && featureReady(status, feature)) {
    then?.();
    return true;
  }
  set({ request: { feature, then } });
  return false;
}

/** Opens the dialog for a feature without anything waiting on it (Settings, a "Set up" button). */
export function openHeissNodes(feature = '') {
  set({ request: { feature } });
  loadHeissNodes({ fresh: true });
}

export function closeHeissNodes() {
  set({ request: null });
}

/** Called by the dialog when the feature it was opened for is ready. */
export function finishHeissNodesRequest() {
  const then = store.request?.then;
  set({ request: null });
  then?.();
}

/** Runs whenever the pack becomes ready, from any route (the dialog, Settings, a restart). */
export function onHeissNodesReady(listener: () => void) {
  readyListeners.add(listener);
  return () => { readyListeners.delete(listener); };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useHeissNodes() {
  return useSyncExternalStore(subscribe, () => store, () => store);
}
