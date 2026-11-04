export type Role = 'player' | 'creator' | 'admin';
export type User = { id: string; email: string; pseudo: string; avatar: string; role: Role; verified: boolean };
export type Page = 'dashboard' | 'catalogue' | 'live' | 'quizzes' | 'history' | 'leaderboard' | 'profile' | 'admin';
export type Choice = { id?: string; text: string; correct: boolean };
export type QuestionInput = { text: string; explanation: string; duration: number; answers: Choice[] };
export type Quiz = {
  id: string; title: string; description: string; category: string; cover: string; visibility: 'public' | 'private' | 'invitation';
  published: number; owner_id: string; owner?: string; question_count: number; invitation_code?: string; questions?: QuestionInput[];
};
export type Session = {
  id: string; quiz_id: string; title: string; description: string; category: string; cover: string; owner_id: string; owner: string;
  mode: 'live' | 'async'; opens_at: number; closes_at: number; status: string; visibility: string;
  player_count: number; question_count: number; participation_status: string | null; invitation_code?: string;
};
export type BoardEntry = { id: string; pseudo: string; avatar: string; score: number; games?: number; status?: string; excluded?: boolean };
export type History = { id: string; session_id: string; title: string; category: string; mode: 'live' | 'async'; score: number; status: string; finished_at: number | null; question_count: number; excluded?: boolean };
export type GameState = {
  id: string; title: string; mode: 'live' | 'async'; state: string; host: boolean; total: number; index: number;
  players: BoardEntry[]; score: number; closesAt: number; serverTime: number; answered: boolean;
  question: null | { id: string; text: string; duration: number; endsAt: number; explanation?: string;
    selected?: string; points?: number; answers: { id: string; text: string; correct?: boolean }[] };
  correction: null | { text: string; explanation: string; selected: string | null; correct: string; points: number }[];
};
export type Statistics = { questions: { id: string; text: string; responses: number; correct: number; average_ms: number }[];
  players: { pseudo: string; score: number; status: string; mode: string }[] };
export type AdminData = { users: (User & { disabled: boolean })[]; reports: { id: string; title: string; pseudo: string; reason: string; status: string }[];
  sessions: { id: string; title: string; mode: 'live' | 'async'; status: string; created_at: number; opens_at: number; closes_at: number;
    owner_id: string; owner: string; player_count: number; participation_status: string | null }[];
  totals: { quizzes: number; sessions: number; participations: number } };
export type CollectiveReport = {
  id: string; title: string; category: string; mode: 'live' | 'async'; status: string; created_at: number; question_count: number;
  players: { id: string; pseudo: string; score: number; status: string; finished_at: number | null; responses: number; correct: number; excluded?: boolean }[];
};