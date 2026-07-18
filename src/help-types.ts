export type HelpGroup = 'New users' | 'Understand your position' | 'Advanced planning' | 'Your data';

export type HelpBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'steps'; title?: string; items: string[] }
  | { type: 'example'; title: string; intro?: string; rows?: Array<{ label: string; value: string }>; text?: string[] }
  | { type: 'result-list'; title?: string; items: Array<{ term: string; explanation: string }> }
  | { type: 'definitions'; items: Array<{ term: string; definition: string }> }
  | { type: 'topics'; title?: string; slugs: string[] }
  | { type: 'note' | 'warning'; title?: string; text: string }
  | { type: 'mistakes'; items: string[] };

export interface HelpTopic {
  slug: string;
  title: string;
  group: HelpGroup;
  summary: string;
  keywords: string[];
  relatedSection: string;
  blocks: HelpBlock[];
}
