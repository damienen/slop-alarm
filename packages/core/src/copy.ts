/**
 * User-facing wording for verdicts and tells. Kept in core so the popup, the on-page badge and
 * the store listing never drift apart.
 *
 * Wording rule: never state authorship as fact. A detector estimates; it does not prove.
 */
import type { ConfidenceLevel, TellFamily, Verdict } from './contract.js';

export const VERDICT_COPY: Record<Verdict, { label: string; short: string; detail: string; tone: 'ok' | 'warn' | 'alert' | 'muted' }> = {
  likely_human: {
    label: 'Likely human',
    short: 'Human',
    detail: 'This reads like a person wrote it. Few or no AI writing habits were found.',
    tone: 'ok',
  },
  unclear: {
    label: 'Unclear',
    short: 'Unclear',
    detail: 'The signals point in different directions. This could be human writing, edited AI text, or a mix.',
    tone: 'warn',
  },
  likely_ai: {
    label: 'Likely AI',
    short: 'AI?',
    detail: 'This text shows several habits typical of AI-generated writing.',
    tone: 'alert',
  },
  very_likely_ai: {
    label: 'Very likely AI',
    short: 'AI',
    detail: 'This text is full of habits typical of AI-generated writing.',
    tone: 'alert',
  },
  too_short: {
    label: 'Not enough text',
    short: '…',
    detail: 'Select or open at least a few sentences (about 40 words) so there is something to judge.',
    tone: 'muted',
  },
};

export const CONFIDENCE_COPY: Record<ConfidenceLevel, string> = {
  low: 'Low confidence',
  medium: 'Medium confidence',
  high: 'High confidence',
};

export const TELL_COPY: Record<TellFamily, { label: string; detail: string }> = {
  staging: {
    label: 'Staged emphasis',
    detail: '"It\'s not X, it\'s Y" contrasts, dramatic one-line closers, or announced run-ups like "Let\'s dive in".',
  },
  rhythm: {
    label: 'Rhythm by rule',
    detail: 'Ideas forced into threes, dashes joining most clauses, or repeated sentence openings.',
  },
  inflation: {
    label: 'Inflated language',
    detail: 'Ordinary facts framed as pivotal, stock words like "delve" or "tapestry", or unnamed experts.',
  },
  formatting: {
    label: 'Decorative formatting',
    detail: 'Bold labels on every bullet, Title Case headings, or emoji section markers.',
  },
  chat_residue: {
    label: 'Chatbot leftovers',
    detail: 'Phrases from an assistant conversation, such as "I hope this helps" or "Great question!".',
  },
};

export const DISCLAIMER =
  'Slop Alarm gives an estimate, not proof. AI detection can be wrong in both directions. Do not use it as the only basis for accusing anyone.';

/** Never shows 0% or 100%: this is an estimate, and certainty would overclaim. */
export function percent(p: number | null): string {
  if (p === null) return '-';
  return `${Math.min(99, Math.max(1, Math.round(p * 100)))}%`;
}
