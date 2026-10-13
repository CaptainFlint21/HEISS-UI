import React, { useEffect, useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { Modal } from './Modal';
import { NodeInstall } from './NodeInstall';
import { ComfyRestart } from './ComfyRestart';
import { HeatMark } from './HeatMark';
import { Watcher } from './UpscaleDialogs';
import { cn } from './format';
import { closeHeissNodes, featureReady, finishHeissNodesRequest, loadHeissNodes, useHeissNodes, type HeissNodesFeature, type HeissNodesStatus } from './heissNodes';
import { useRtxOffered } from './rtx';
import type { ShowToast } from './toast';

/**
 * HEISS UI Nodes, installed or brought up to date in one place (heissNodes.ts):
 * opened the first time someone touches a feature that runs on the pack, and
 * again when this HEISS needs a newer pack than ComfyUI has. One install
 * brings every feature, so it's asked for once. While open it keeps checking,
 * so an install done by hand, in Manager or on another computer is noticed.
 */
const STEPS = ['Install', 'Restart', 'Ready'] as const;

type Stage = 'checking' | 'offline' | 'install' | 'update' | 'restart' | 'ready';

function stageOf(status: HeissNodesStatus | null, offline: boolean, feature: string): Stage {
  if (!status) return offline ? 'offline' : 'checking';
  if (feature ? featureReady(status, feature) : status.state === 'ready') return 'ready';
  return status.state === 'ready' ? 'update' : status.state;
}

function Steps({ stage, update }: { stage: Stage; update: boolean }) {
  const current = stage === 'ready' ? 3 : stage === 'restart' ? 1 : 0;
  return (
    <ol className="upscale-stepper" aria-label="Setup steps">
      {STEPS.map((step, index) => {
        const state = index < current ? 'done' : index === current ? 'active' : 'todo';
        return (
          <li key={step} className={`is-${state}`} aria-current={state === 'active' ? 'step' : undefined}>
            <i aria-hidden="true">{state === 'done' ? <Check size={10} strokeWidth={3} /> : null}</i>
            <span>{index === 0 && update ? 'Update' : step}</span>
          </li>
        );
      })}
    </ol>
  );
}

function copyFor(stage: Stage, feature: HeissNodesFeature | undefined, status: HeissNodesStatus | null) {
  const name = feature?.label || '';
  switch (stage) {
    case 'checking': return { title: 'HEISS UI Nodes', description: 'Checking ComfyUI…' };
    case 'offline': return { title: 'Waiting for ComfyUI', description: 'Start ComfyUI, and this carries on by itself.' };
    case 'install': return {
      title: name ? `${name} needs HEISS UI Nodes` : 'Add HEISS UI Nodes to ComfyUI',
      description: 'HEISS’s own small add-on for ComfyUI. One install brings every feature below, now and as they arrive.'
    };
    case 'update': return {
      title: 'Update HEISS UI Nodes',
      description: `${name || 'This version of HEISS UI'} needs a newer HEISS UI Nodes than ComfyUI has${status?.loadedVersion ? ` (version ${status.loadedVersion}; it needs ${status.requiredVersion})` : ''}. Everything you use now keeps working.`
    };
    case 'restart': return { title: 'Restart ComfyUI to finish', description: 'The new HEISS UI Nodes are in place. ComfyUI loads them when it restarts.' };
    case 'ready': return { title: name ? `${name} is ready` : 'HEISS UI Nodes are ready', description: 'Everything below runs on this ComfyUI now.' };
  }
}

export function HeissNodesDialog({ showToast }: { showToast: ShowToast }) {
  const { status, offline, checkedAt, request } = useHeissNodes();
  const nvidia = useRtxOffered();
  const open = Boolean(request);
  const featureId = request?.feature || '';
  const stage = stageOf(status, offline, featureId);
  const feature = status?.features.find((item) => item.id === featureId);
  const [held, setHeld] = useState(false);
  // Install or update, as it was when the dialog opened: the first step keeps its word through restart and ready.
  const [updating, setUpdating] = useState(false);
  useEffect(() => {
    if (!open) { setUpdating(false); return; }
    if (stage === 'update') setUpdating(true);
  }, [open, stage]);

  // While open and not ready: look again every few seconds (an install by hand, a restart elsewhere).
  useEffect(() => {
    if (!open || stage === 'ready') return;
    const timer = window.setInterval(() => loadHeissNodes(), 4000);
    return () => window.clearInterval(timer);
  }, [open, stage]);

  // Ready for what was waiting: hold the moment for a beat, then carry on with it.
  useEffect(() => {
    if (!open || stage !== 'ready' || !request?.then || held) return;
    setHeld(true);
    const timer = window.setTimeout(() => { setHeld(false); finishHeissNodesRequest(); }, 1300);
    return () => window.clearTimeout(timer);
  }, [open, stage, request, held]);

  const { title, description } = copyFor(stage, feature, status);
  // NVIDIA-only features show only where they can run; the one that opened this always shows.
  const features = (status?.features || []).filter((item) => !item.nvidia || nvidia || item.id === featureId);
  const newer = (item: HeissNodesFeature) => stage === 'update' && item.version > (status?.loadedVersion || 0);
  const later = <button className="btn is-ghost" onClick={closeHeissNodes}>Not now</button>;
  const recheck = <button className="btn" onClick={() => loadHeissNodes({ fresh: true })}><RefreshCw size={13} /> Check again</button>;

  let action: React.ReactNode = null;
  let footer: React.ReactNode = <>{later}{recheck}</>;
  if (stage === 'checking') {
    action = <Watcher>Checking ComfyUI…</Watcher>;
    footer = later;
  } else if (stage === 'offline') {
    action = <Watcher lastChecked={checkedAt}>Waiting for ComfyUI</Watcher>;
  } else if ((stage === 'install' || stage === 'update') && status?.setup) {
    action = (
      <>
        <NodeInstall
          pack={status.setup.pack}
          plan={status.setup}
          managerHint={status.setup.manager}
          autoInstall={status.setup.autoInstall}
          showToast={showToast}
          onRestarted={() => loadHeissNodes({ fresh: true })}
          afterRestart={feature ? `Then ${feature.label} is ready.` : ''}
          verb={stage === 'update' ? 'Update' : 'Install'}
          resumeFinished={false}
        />
        {status.local?.present && !status.local.git && stage === 'update'
          ? <p className="upscale-fine">The copy in ComfyUI wasn’t installed with git, so it’s set aside (renamed, not deleted) and the new one installed in its place.</p>
          : null}
      </>
    );
  } else if (stage === 'restart') {
    action = (
      <>
        <ComfyRestart className="upscale-restart" onBack={() => loadHeissNodes({ fresh: true })} />
        <Watcher lastChecked={checkedAt}>Waiting for ComfyUI to load the new nodes…</Watcher>
      </>
    );
  } else if (stage === 'ready') {
    footer = request?.then ? null : <button className="btn is-primary" onClick={closeHeissNodes}>Done</button>;
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) closeHeissNodes(); }}
      size="form"
      className="upscale-modal heiss-nodes-modal"
      hero={
        <div className="upscale-hero-wrap heiss-nodes-hero" data-stage={stage}>
          <HeatMark className="heiss-nodes-mark" />
          <Steps stage={stage} update={updating} />
        </div>
      }
      title={title}
      description={description}
      footer={footer}
    >
      <div className="upscale-body" key={stage}>
        {features.length ? (
          <ul className="upscale-files heiss-nodes-features" aria-label="What HEISS UI Nodes bring">
            {features.map((item) => (
              <li key={item.id} className={cn(item.ready && 'is-done', item.id === featureId && 'is-asked')}>
                <div>
                  <strong>{item.label}{item.nvidia ? <em>NVIDIA RTX</em> : null}</strong>
                  <span className="heiss-nodes-blurb">{item.blurb}</span>
                </div>
                <span>{item.ready ? <><Check size={12} strokeWidth={3} /> Ready</> : newer(item) ? 'New' : stage === 'restart' ? 'After restart' : 'With the install'}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {action ? <div className="heiss-nodes-action">{action}</div> : null}
        {stage === 'install' || stage === 'update'
          ? <p className="upscale-fine">A few hundred KB, at the version this HEISS was made for. It never changes ComfyUI’s PyTorch.</p>
          : null}
      </div>
    </Modal>
  );
}
