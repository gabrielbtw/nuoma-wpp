import type { ChannelType } from "@nuoma/contracts";

import {
  Field,
  Input,
  NumberInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@nuoma/ui";

import type { StepDraft } from "../../../flow-builder/lib/build-steps.js";
import { temporaryMessagesDurations } from "../../../flow-builder/lib/builder-options.js";
import {
  instagramSupportedStepTypes,
  stepDraftFieldErrors,
} from "../../../flow-builder/lib/validation.js";
import { humanizeSeconds } from "../config/step-registry.js";
import { MediaPicker } from "./fields/MediaPicker.js";

export interface StepFieldsProps {
  step: StepDraft;
  order: number;
  channel: ChannelType | "";
  showDelay?: boolean;
  onPatch: (patch: Partial<StepDraft>) => void;
}

/**
 * Type-specific content editor for a campaign step draft. Shared between the
 * campaign inspector and the automation send_step inspector.
 */
export function StepFields({ step, order, channel, showDelay = true, onPatch }: StepFieldsProps) {
  const errors = stepDraftFieldErrors(step, order);
  const unsupported = channel === "instagram" && !instagramSupportedStepTypes.has(step.type);

  return (
    <div className="grid gap-3.5">
      {unsupported ? (
        <p className="rounded-md border border-status-warn/40 bg-status-warn/10 px-3 py-2 text-xs leading-5 text-status-warn">
          Este tipo de bloco não é suportado no Instagram. Troque o canal do fluxo ou remova o bloco
          antes de publicar.
        </p>
      ) : null}

      <Field label="Nome do bloco">
        <Input
          value={step.label}
          onChange={(event) => onPatch({ label: event.target.value })}
          placeholder={`Step ${order}`}
          className="h-10"
        />
      </Field>

      {showDelay ? (
        <Field
          label="Atraso antes do envio"
          description={`Espera ${humanizeSeconds(step.delaySeconds)} antes de enviar este bloco.`}
        >
          <NumberInput
            value={step.delaySeconds}
            min={0}
            step={5}
            onValueChange={(_parsed, raw) => onPatch({ delaySeconds: raw })}
            aria-label="Atraso em segundos"
          />
        </Field>
      ) : null}

      {step.type === "text" ? (
        <Field
          label="Mensagem"
          error={errors.template}
          description="Use {{nome}} para personalizar com o nome do contato."
        >
          <Textarea
            value={step.template}
            rows={5}
            invalid={Boolean(errors.template)}
            aria-invalid={Boolean(errors.template)}
            onChange={(event) => onPatch({ template: event.target.value })}
            placeholder="Olá {{nome}}, tudo bem?"
            data-testid="step-message-input"
          />
        </Field>
      ) : null}

      {step.type === "link" ? (
        <>
          <Field label="Texto da mensagem" error={errors.linkText}>
            <Textarea
              value={step.linkText}
              rows={3}
              invalid={Boolean(errors.linkText)}
              onChange={(event) => onPatch({ linkText: event.target.value })}
              placeholder="Confira os detalhes:"
            />
          </Field>
          <Field label="URL" error={errors.url}>
            <Input
              value={step.url}
              monospace
              invalid={Boolean(errors.url)}
              onChange={(event) => onPatch({ url: event.target.value })}
              placeholder="https://…"
              className="h-10"
            />
          </Field>
          <label className="flex items-center justify-between gap-3 rounded-md border border-line-hairline bg-surface-1/60 px-3 py-2.5">
            <span className="text-xs text-ink">Mostrar preview do link</span>
            <Switch
              checked={step.previewEnabled}
              onCheckedChange={(checked) => onPatch({ previewEnabled: checked })}
            />
          </label>
        </>
      ) : null}

      {step.type === "voice" ? (
        <MediaPicker
          type="voice"
          label="Voice note"
          value={step.mediaAssetId}
          error={errors.mediaAssetId}
          onChange={(id) => onPatch({ mediaAssetId: id })}
        />
      ) : null}

      {step.type === "image" || step.type === "video" ? (
        <>
          <MediaPicker
            type={step.type}
            label={step.type === "image" ? "Imagem" : "Vídeo"}
            value={step.mediaAssetId}
            error={errors.mediaAssetId}
            onChange={(id) => onPatch({ mediaAssetId: id })}
          />
          <Field label="Legenda" description="Opcional — acompanha a mídia.">
            <Textarea
              value={step.caption}
              rows={2}
              onChange={(event) => onPatch({ caption: event.target.value })}
              placeholder="Legenda da mídia…"
            />
          </Field>
        </>
      ) : null}

      {step.type === "document" ? (
        <>
          <MediaPicker
            type="document"
            label="Documento"
            value={step.mediaAssetId}
            error={errors.mediaAssetId}
            onChange={(id) => onPatch({ mediaAssetId: id })}
          />
          <Field label="Nome do arquivo" error={errors.fileName}>
            <Input
              value={step.fileName}
              invalid={Boolean(errors.fileName)}
              onChange={(event) => onPatch({ fileName: event.target.value })}
              placeholder="proposta.pdf"
              className="h-10"
            />
          </Field>
          <Field label="Legenda" description="Opcional.">
            <Textarea
              value={step.caption}
              rows={2}
              onChange={(event) => onPatch({ caption: event.target.value })}
            />
          </Field>
        </>
      ) : null}

      {step.type === "temporary_messages" ? (
        <Field
          label="Duração das mensagens temporárias"
          description="Ativa o modo de mensagens temporárias na conversa antes dos próximos envios."
        >
          <Select
            value={step.temporaryMessagesDuration}
            onValueChange={(value) =>
              onPatch({
                temporaryMessagesDuration: value as StepDraft["temporaryMessagesDuration"],
              })
            }
          >
            <SelectTrigger className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {temporaryMessagesDurations.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}
    </div>
  );
}
