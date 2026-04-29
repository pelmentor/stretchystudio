// @ts-check

/**
 * v3 Phase 1B — ParameterTab.
 *
 * Inspector for the parameter selected via the ParametersEditor (or
 * any future surface that dispatches `{type: 'parameter', id}`). Shows
 * id / name / range / default + the live current value. Editing
 * (rename, range tweak, default change) lands as a follow-up; first
 * cut is read-only.
 *
 * @module v3/editors/properties/tabs/ParameterTab
 */

import { useProjectStore } from '../../../../store/projectStore.js';
import { useParamValuesStore } from '../../../../store/paramValuesStore.js';
import { Sliders } from 'lucide-react';

/**
 * @param {Object} props
 * @param {string} props.parameterId
 */
export function ParameterTab({ parameterId }) {
  const param = useProjectStore((s) =>
    (s.project.parameters ?? []).find((p) => p?.id === parameterId) ?? null,
  );
  const liveValue = useParamValuesStore((s) =>
    s.values[parameterId] ?? param?.default ?? 0,
  );

  if (!param) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        Parameter not in project — was it removed by Initialize Rig?
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 p-2 overflow-auto">
      <Section
        label="Parameter"
        icon={<Sliders size={11} />}
      >
        <Row label="ID">
          <code className="text-xs text-foreground truncate" title={param.id}>{param.id}</code>
        </Row>
        <Row label="Name">
          <span className="text-xs text-foreground truncate">{param.name ?? param.id}</span>
        </Row>
        <Row label="Role">
          <span className="text-xs text-foreground font-mono">{param.role ?? '—'}</span>
        </Row>
      </Section>

      <Section label="Range">
        <Row label="Min">
          <span className="text-xs text-foreground tabular-nums font-mono">
            {param.min ?? 0}
          </span>
        </Row>
        <Row label="Max">
          <span className="text-xs text-foreground tabular-nums font-mono">
            {param.max ?? 1}
          </span>
        </Row>
        <Row label="Default">
          <span className="text-xs text-foreground tabular-nums font-mono">
            {param.default ?? 0}
          </span>
        </Row>
        <Row label="Live">
          <span className="text-xs text-primary tabular-nums font-mono font-semibold">
            {Number(liveValue).toFixed(param.decimalPlaces ?? 2)}
          </span>
        </Row>
      </Section>

      {param.boneId || param.variantSuffix || param.groupId ? (
        <Section label="Linked">
          {param.boneId ? (
            <Row label="Bone">
              <code className="text-xs text-foreground truncate">{param.boneId}</code>
            </Row>
          ) : null}
          {param.variantSuffix ? (
            <Row label="Variant">
              <code className="text-xs text-foreground truncate">{param.variantSuffix}</code>
            </Row>
          ) : null}
          {param.groupId ? (
            <Row label="Group">
              <code className="text-xs text-foreground truncate">{param.groupId}</code>
            </Row>
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}

function Section({ label, icon = null, children }) {
  return (
    <div className="flex flex-col gap-1 border border-border rounded p-2 bg-card/30">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5 flex items-center gap-1">
        {icon ? <span className="text-muted-foreground/80">{icon}</span> : null}
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-center gap-2 text-xs h-6">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <div className="flex-1 flex items-center min-w-0">{children}</div>
    </div>
  );
}
