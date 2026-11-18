export type ColdEmailTone = 'casual' | 'professional' | 'direct' | 'friendly';
export type ColdEmailLength = 'short' | 'medium';

export type ColdEmailInputs = {
  companyName?: string;
  companyWebsite?: string;
  targetPersonName?: string;
  targetPersonRole?: string;
  painPoints?: string;
  ourOffer?: string;
  senderName?: string;
  senderCompany?: string;
  goal?: string;
  tone?: ColdEmailTone;
  length?: ColdEmailLength;
  extraNotes?: string;
};

export type FollowUpMessage = {
  day: number;
  message: string;
};

export type ColdEmailOutputs = {
  subject_lines: string[];
  email: string;
  follow_ups: FollowUpMessage[];
  personalization_used: string;
};

export type ColdEmailRecord = {
  id: number;
  userId: number;
  inputs: ColdEmailInputs;
  outputs: ColdEmailOutputs;
  modelUsed: string;
  createdAt: string;
  expiresAt: string;
};
