
export type UserLevel = 'iniciante' | 'intermediario' | 'avancado';

export interface PlanConfig {
    startDate: string; // ISO Date string indicating when the schedule starts/re-starts
    isPaused: boolean;
}

// NEW: Interface para controlar cada instância de revisão futura
export interface ScheduledRevision {
    id: string; // UUID único desta revisão
    sourceGoalId: string; // ID da meta original (Aula 01)
    dueDate: string; // Data agendada (YYYY-MM-DD)
    interval: number; // Qual intervalo é esse (1, 7, 15, etc)
    completed: boolean;
}

// NEW: Interface para conjuntos de flashcards pessoais
export interface PersonalFlashcardSet {
    id: string;
    name: string;
    cards: Flashcard[];
}

// NEW: Interface para Mapas Mentais Pessoais
export interface PersonalMindMap {
    id: string;
    name: string;
    root: MindMapNode;
    createdAt: string;
}

// NEW: Interface para Cadernos de Anotações (Rich Text)
export interface PersonalNote {
    id: string;
    title: string;
    content: string; // HTML String do editor
    updatedAt: string;
}

export interface User {
  id: string;
  name: string;
  nickname?: string; // NEW: Apelido para o Ranking
  email: string;
  cpf: string;
  level: UserLevel;
  isAdmin: boolean;
  allowedPlans: string[]; // Plan IDs
  allowedSimuladoClasses: string[]; // NEW: IDs of Simulado Classes
  planExpirations: Record<string, string>; // PlanID -> Date ISO string
  simuladoExpirations: Record<string, string>; // ClassID -> Date ISO string (NEW)
  
  // Per-plan configuration (Start Date, Pause Status)
  planConfigs: Record<string, PlanConfig>; 
  
  routine: Routine;
  currentPlanId?: string;
  progress: UserProgress; 
  // Store computed schedule to avoid re-calc every render
  schedule?: Record<string, ScheduledItem[]>; // DateStr -> Items
  
  // New Feature: Estudo Semiativo (Dobrar tempo de aulas)
  semiActiveStudy?: boolean;
  
  // New Feature: Fila de Revisões Espaçadas
  revisions?: ScheduledRevision[];

  // NEW: Flashcards criados pelo próprio usuário (Privados)
  // Key: goalId
  personalFlashcardSets?: Record<string, PersonalFlashcardSet[]>;

  // NEW: Mapas Mentais criados pelo próprio usuário (Privados)
  // Key: goalId
  personalMindMaps?: Record<string, PersonalMindMap[]>;

  // NEW: Cadernos de Anotações (Privados)
  // Key: goalId
  personalNotes?: Record<string, PersonalNote[]>;

  // Auth
  tempPassword?: string;
  
  // NEW: Data de cadastro
  createdAt?: string;

  // NEW: Permissões de Colaborador (RBAC)
  // 'plans_access' | 'users_access' | 'simulados_access' | 'master_access'
  permissions?: string[]; 
}

export interface UserProgress {
  completedGoalIds: string[];
  completedRevisionIds: string[]; // "goalId_revisionIndex"
  totalStudySeconds: number;
  planStudySeconds: Record<string, number>; // Time spent per plan
  lastCycleIndex?: number;
}

export interface Routine {
  days: {
    [key: string]: number; // "monday": 60 (minutes available)
  };
}

export type GoalType = 'AULA' | 'MATERIAL' | 'QUESTOES' | 'LEI_SECA' | 'RESUMO' | 'REVISAO' | 'SIMULADO';

export interface SubGoal {
  id: string;
  title: string;
  link: string;
  duration: number; // minutes
}

export interface Flashcard {
  id: string;
  question: string;
  answer: string;
}

export interface GoalFile {
  name: string;
  url: string;
}

// NEW: Interface para múltiplos links nomeados
export interface GoalLink {
  name: string;
  url: string;
}

// NEW: Post-It / Comentário no Mapa Mental
export interface MindMapComment {
    id: string;
    content: string; // HTML rich text
    backgroundColor: string; // Hex color or Tailwind class
    createdAt: string;
}

// NEW: Imagem no Mapa Mental
export interface MindMapImage {
    url: string;
    position: 'top' | 'bottom' | 'left' | 'right';
    scale: number; // Multiplicador de tamanho (0.5 a 2.5)
}

// NEW: Estrutura do Mapa Mental (IA)
export interface MindMapNode {
    id: string;
    label: string;
    children?: MindMapNode[];
    color?: string; // NEW: Custom neon color class (e.g., 'purple', 'blue')
    comments?: MindMapComment[]; // NEW: Lista de Post-Its
    image?: MindMapImage; // NEW: Imagem opcional
}

export interface Goal {
  id: string;
  title: string;
  type: GoalType;
  description?: string; // Observações do admin
  color?: string; // Cor personalizada da meta (Hex)
  
  // Common Links/Files
  link?: string; // Legacy link (Principal)
  links?: GoalLink[]; // Support for multiple named links
  pdfUrl?: string; // Legacy file (Principal)
  pdfUrls?: GoalFile[]; // support for multiple named files
  
  // Type: AULA
  subGoals?: SubGoal[]; 
  
  // Type: MATERIAL / QUESTOES / LEI_SECA
  pages?: number;
  
  // Type: LEI_SECA
  articles?: string; // "Arts. 1 to 5"
  multiplier?: number; // 2x, 3x...

  // Type: RESUMO
  manualTime?: number; // Admin defined minutes
  mindMapSourcePdfs?: GoalFile[]; // PDFs usados para gerar o mapa
  generatedMindMap?: MindMapNode; // Estrutura do mapa mental
  
  // Type: REVISAO (New Feature: Flashcards)
  flashcards?: Flashcard[];

  // Revisions
  hasRevision?: boolean;
  revisionIntervals?: string; // "1,7,15,30"
  repeatLastInterval?: boolean;
  
  // Sorting
  order: number;
}

export interface Subject {
  id: string;
  name: string;
  goals: Goal[];
  order: number;
}

export interface Discipline {
  id: string;
  name: string;
  folderId?: string; // If null, root level
  subjects: Subject[];
  order: number;
}

export interface Folder {
  id: string;
  name: string;
  order: number;
}

export interface CycleItem {
  disciplineId?: string; // Optional if folderId is present
  folderId?: string; // New: Supports adding a whole folder
  simuladoId?: string; // New: Supports adding a Simulado Exam directly
  subjectsCount: number; // How many subjects to advance per discipline in this slot (ignored for Simulado)
}

export interface Cycle {
  id: string;
  name: string;
  items: CycleItem[];
  order: number;
}

// --- EDITAL VERTICALIZADO TYPES ---

export interface EditalSubTopic {
    id: string;
    name: string;
    links: {
        aula?: string;
        material?: string;
        questoes?: string;
        leiSeca?: string;
        resumo?: string;
        revisao?: string; 
    };
    order: number;
}

export interface EditalTopic {
    id: string;
    name: string;
    // Maps specific slots to Goal IDs existing in the Plan
    links: {
        aula?: string;
        material?: string;
        questoes?: string;
        leiSeca?: string;
        resumo?: string;
        revisao?: string; 
    };
    subTopics?: EditalSubTopic[];
    relatedContests?: string[]; // Array of contest names (e.g. ['PF', 'PRF'])
    order: number;
}

export interface EditalDiscipline {
    id: string;
    name: string;
    topics: EditalTopic[];
    order: number;
}

export type PlanCategory = string; 

// NEW: Interface para Definição de Categorias Dinâmicas
export interface CategoryDefinition {
    name: string;
    subCategories: string[];
}

export interface StudyPlan {
  id: string;
  name: string;
  category: PlanCategory;
  subCategory?: string; // NEW: Subcategoria selecionada
  organization?: string; // NEW: Órgão (Ex: PC/AC)
  coverImage: string;
  folders: Folder[];
  disciplines: Discipline[];
  cycles: Cycle[];
  cycleSystem: 'continuo' | 'rotativo';
  brandingLogo?: string;
  
  // New Feature
  editalVerticalizado?: EditalDiscipline[];
  linkedContests?: string[]; // Master list of contests for this plan (e.g. ['PF', 'PRF', 'PC-DF'])
  enableActiveUserMode?: boolean; // NEW: Allows manual completion in Edital
  
  // New Feature: Linked Simulado Classes
  linkedSimuladoClasses?: string[]; // IDs of SimuladoClasses linked to this plan

  // NEW: Link de redirecionamento para compra
  purchaseLink?: string;

  // NEW: Data de criação para ordenação
  createdAt?: string; 
}

export interface ScheduledItem {
  uniqueId: string; // Generated for the schedule
  date: string; // YYYY-MM-DD
  goalId: string; // Can be SimuladoID
  subGoalId?: string; // If it's a specific class/subgoal
  goalType: GoalType;
  title: string;
  disciplineName: string;
  subjectName: string;
  duration: number; // minutes scheduled for this slot
  isRevision: boolean;
  revisionIndex?: number;
  completed: boolean;
  originalGoal?: Goal; // helper (Undefined if it is a Simulado)
  
  // Simulado Specific
  simuladoData?: Simulado;

  // Splitting Logic
  isSplit?: boolean;
  partIndex?: number; // 1, 2...
  totalParts?: number; // 2...
  
  // Status
  isLate?: boolean;
}

// --- SIMULADOS (MOCK EXAMS) SYSTEM ---

export interface SimuladoClass {
    id: string;
    name: string;
    description?: string;
    simulados: Simulado[];
    coverImage?: string; // NEW: Capa da turma (1080x1080)
    purchaseLink?: string; // NEW: Link de redirecionamento para compra
    category?: string; // NEW: Categoria
    subCategory?: string; // NEW: Subcategoria
    organization?: string; // NEW: Órgão (Ex: PC/AC)
    createdAt?: string; // NEW: Data de criação
}

export interface SimuladoBlock {
    id: string;
    name: string;
    questionCount: number;
    minCorrect?: number; // Min questions required to pass block
}

export interface SimuladoQuestionConfig {
    discipline: string;
    topic: string;
    observation?: string;
}

export interface Simulado {
    id: string;
    title: string;
    type: 'MULTIPLA_ESCOLHA' | 'CERTO_ERRADO';
    optionsCount: number; // 4 or 5 for Multiple Choice
    totalQuestions: number;
    
    // Configs
    hasPenalty: boolean; // Penalidade (Certo/Errado logic usually)
    hasBlocks: boolean;
    blocks: SimuladoBlock[];
    
    // Approval
    minTotalPercent?: number;
    
    // Files
    pdfUrl?: string; // Exam file
    gabaritoPdfUrl?: string; // Answer key file
    
    // Admin Answer Key & Diagnosis Config
    // Key: Question Number (1, 2, 3...)
    correctAnswers: Record<number, string>; // "A", "C", "E" (Errado), "C" (Certo)
    questionValues: Record<number, number>; // Points per question
    
    hasDiagnosis: boolean;
    // Map Question Number -> Config
    diagnosisMap: Record<number, SimuladoQuestionConfig>;
}

export interface SimuladoAttempt {
    id: string;
    userId: string;
    simuladoId: string;
    classId: string;
    date: string; // ISO
    
    // Answers: QNum -> UserAnswer
    answers: Record<number, string | null>; // null if blank
    
    // Diagnosis: QNum -> Reason
    // Reasons: 'DOMINIO', 'CHUTE_CONSCIENTE', 'CHUTE_SORTE', 'FALTA_CONTEUDO', 'FALTA_ATENCAO', 'INSEGURANCA'
    diagnosisReasons: Record<number, string>; 
    
    score: number;
    isApproved: boolean;
    blockResults?: Record<string, { total: number, correct: number, approved: boolean }>;
}

export interface DatabaseBackup {
    version: string;
    timestamp: string;
    users: User[];
    plans: StudyPlan[];
    simulados_classes: SimuladoClass[];
    simulados_attempts: SimuladoAttempt[];
}

export interface CloudBackup {
    id: string;
    label: string;
    createdAt: string;
    url: string;
    version: string;
    createdBy: string;
}
