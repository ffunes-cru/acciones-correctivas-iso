export enum UserRole {
  ADMIN = 'admin',
  USER = 'user'
}

export enum FindingStatus {
  PENDING_ANALYSIS = 'pending_analysis',
  PENDING_ACTION = 'pending_action',
  PENDING_VERIFICATION = 'pending_verification',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  REJECTED = 'rejected'
}

export enum ActionStatus {
  PENDING = 'pending',
  FINISHED = 'finished',
  CANCELLED = 'cancelled',
  REJECTED = 'rejected'
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: any;
  googleSheetsToken?: string;
  googleSheetsTokenTime?: number;
}

export interface Finding {
  id: string;
  findingNumber: number;
  company: string;
  findingDate: any;
  origin: string;
  type: string;
  process: string;
  description: string;
  ownerId: string;
  ownerEmail: string;
  analysisResponsibleId?: string;
  analysisResponsibleEmail?: string;
  analysisDeadline?: any;
  status: FindingStatus;
  involvedUserIds?: string[];
  pendingActionUserIds?: string[];
  createdAt: any;
  updatedAt: any;
  isVerified?: boolean;
  verificationDate?: any;
  findingCategory?: 'corrective' | 'improvement';
  isSpecialRelease?: boolean;
  specialReleaseId?: string;
}

export interface SpecialReleaseApproval {
  userId: string;
  userEmail: string;
  userName: string;
  status: 'pending' | 'approved' | 'rejected';
  comments?: string;
  actionDate?: any;
  excluded?: boolean;
}

export interface SpecialReleaseNotification {
  userId: string;
  userEmail: string;
  userName: string;
  confirmed: boolean;
  confirmedDate?: any;
}

export interface SpecialReleaseLinkedAction {
  id: string;
  findingId: string;
  findingNumber: number;
  description: string;
  responsibleId: string;
  responsibleName: string;
  deadline: any;
  createdAt: any;
}

export interface SpecialRelease {
  id: string;
  releaseNumber: number;
  type: 'raw_material' | 'finished_product';
  company: string;
  date: any;
  deviationDescription: string;
  clientImpact: string;
  creatorId: string;
  creatorEmail: string;
  creatorName: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected';
  createdAt: any;
  updatedAt: any;

  // Raw Material specific
  purchaseOrderNumber?: string;
  code?: string;
  description?: string;
  vendor?: string;

  // Finished Product specific
  ofNumber?: string;
  machineModel?: string;
  clientDealer?: string;
  salesNoteNumber?: string;

  // Approvals (Calidad, Ingeniería, Comercial, Operaciones)
  approvals: {
    calidad: SpecialReleaseApproval;
    ingenieria: SpecialReleaseApproval;
    comercial: SpecialReleaseApproval;
    operaciones: SpecialReleaseApproval;
  };

  // Notified (Posventa)
  notifications: {
    posventa: SpecialReleaseNotification;
  };

  // Linked actions/findings created in the background
  linkedActions?: SpecialReleaseLinkedAction[];
}

export interface CorrectiveAction {
  id: string;
  findingId: string;
  description: string;
  responsibleId: string;
  responsibleEmail: string;
  deadline: any;
  status: ActionStatus;
  implementationComment?: string;
  executionDate?: any;
  createdAt: any;
  // Verification fields
  isVerified?: boolean;
  verificationComment?: string;
  verificationDate?: any;
}

export interface CauseAnalysis {
  summary: string;
  contingencyActions: string;
  createdAt: any;
}

export interface ISOCalendar {
  id: string;
  year: number;
  company?: string;
  name: string;
  description?: string;
  createdBy: string;
  createdAt: any;
  updatedAt?: any;
}

export interface ISOTask {
  id: string;
  calendarId: string;
  name: string;
  originalTaskName: string;
  frequency: string;
  instanceLabel?: string;
  responsibleId: string;
  responsibleEmail: string;
  responsibleName: string;
  deadline: any;
  status: 'No iniciado' | 'En proceso' | 'Finalizado' | 'No iniciada' | 'Finalizada';
  comments: string;
  auditedPersonnel?: string;
  auditReportLink?: string;
  auditScope?: string;
  auditCriteria?: string;
  completedAt?: any;
  updatedAt?: any;
  sharedEmails?: string[];
}

export interface AreaQuestion {
  id: string;
  question: string;
  applies: 'SI' | 'NO' | 'NA' | '';
  requiresAction: 'SI' | 'NO' | '';
  actionId?: string;
  findingId?: string;
  findingNumber?: number;
  actionDescription?: string;
  actionResponsibleId?: string;
  actionDeadline?: any;
}

export interface AreaReview {
  applies: boolean;
  responsibleId?: string;
  responsibleEmail?: string;
  responsibleName?: string;
  deadline?: any;
  status: 'pending' | 'approved' | 'rejected';
  comments?: string;
  actionDate?: any;
  checklist: AreaQuestion[];
}

export interface ChangeRequest {
  id: string;
  changeNumber: number;
  title: string;
  company?: string;
  description: string;
  objective: string;
  mission: 'Seguridad y Medio Ambiente' | 'Productividad' | 'Calidad' | 'Costos' | 'Otros';
  currentSituation: string;
  proposedSituation: string;
  impactAnalysis: string;
  creatorId: string;
  creatorEmail: string;
  creatorName: string;
  status: 'draft' | 'pending_review' | 'pending_approval' | 'approved' | 'rejected';
  createdAt: any;
  updatedAt: any;

  // Review status of each area
  reviews: {
    ingenieriaProcesos: AreaReview;
    produccion: AreaReview;
    mantenimiento: AreaReview;
    calidad: AreaReview;
    supplyChain: AreaReview;
    hse: AreaReview;
    infraestructura: AreaReview;
    recursosHumanos: AreaReview;
  };

  // Stage 3: Aprobación final
  finalApproverId?: string;
  finalApproverEmail?: string;
  finalApproverName?: string;
  finalApprovalDeadline?: any;
  finalApprovalStatus?: 'pending' | 'approved' | 'rejected';
  finalApprovalComments?: string;
  finalApprovalDate?: any;

  // Stage 4: Comunicación records or logs
  communicationSent?: boolean;
  communicationSentDate?: any;
  communicationNotes?: string;
}
