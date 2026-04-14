export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export interface AnswerPosition {
  x: number; // 0.0 (left) to 1.0 (right)
  y: number; // 0.0 (top) to 1.0 (bottom)
}

export interface QuestionResult {
  number: string;
  student_answer: string;
  is_correct: boolean;
  correct_answer: string | null;
  answer_position: AnswerPosition;
}

export interface GradeData {
  questions: QuestionResult[];
  total_correct: number;
  total_questions: number;
}

export interface StudentResult {
  id: string;
  student_name: string;
  original_image_url: string;
  annotated_image_url: string;
  grade_data: GradeData;
  graded_at: string;
}
