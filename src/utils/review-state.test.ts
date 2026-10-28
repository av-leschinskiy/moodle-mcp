import { describe, expect, it } from 'vitest';
import { reviewState } from './review-state.js';
import type { ReviewInput } from './review-state.js';

const T = (at: number) => ({ at, byTeacher: true });
const S = (at: number) => ({ at, byTeacher: false });

function state(input: Partial<ReviewInput>) {
  return reviewState({
    status: 'submitted',
    modifiedAt: 100,
    gradedAt: null,
    feedbackAt: null,
    comments: [],
    ...input,
  });
}

describe('reviewState', () => {
  it.each<[string, Partial<ReviewInput>, string]>([
    ['нет записи сдачи', { status: undefined, modifiedAt: undefined }, 'not_submitted'],
    ['статус new', { status: 'new' }, 'not_submitted'],
    ['черновик без реакции преподавателя', { status: 'draft' }, 'not_submitted'],
    ['черновик после комментария преподавателя', { status: 'draft', comments: [T(150)] }, 'rework'],
    ['черновик после отзыва без оценки', { status: 'draft', feedbackAt: 150 }, 'rework'],
    ['новая попытка', { status: 'reopened' }, 'rework'],
    ['сдана, ни оценки, ни комментариев', {}, 'new_submission'],
    ['сдана, комментарий студента к сдаче', { comments: [S(90)] }, 'new_submission'],
    ['сдана после комментария преподавателя', { comments: [T(50)] }, 'resubmitted'],
    ['сдана после оценки прошлой попытки', { feedbackAt: 50 }, 'resubmitted'],
    ['сдана, преподаватель ответил позже', { comments: [T(150)] }, 'awaiting_student'],
    ['оценена, не менялась', { gradedAt: 200 }, 'graded'],
    ['оценена в ту же секунду', { gradedAt: 100 }, 'graded'],
    ['изменена после оценки', { gradedAt: 50 }, 'update_unreviewed'],
    [
      'изменена после оценки, комментарий только до изменения',
      { gradedAt: 50, comments: [T(70)] },
      'update_unreviewed',
    ],
    [
      'изменена после оценки, комментарий после изменения',
      { gradedAt: 50, comments: [T(120)] },
      'update_reviewed',
    ],
    [
      'досылка разобрана, студент писал до ответа',
      { gradedAt: 50, comments: [S(99), T(120)] },
      'update_reviewed',
    ],
    ['оценена, студент написал после', { gradedAt: 200, comments: [S(250)] }, 'student_comment'],
    ['оценена, студент написал до оценки', { gradedAt: 200, comments: [T(150), S(180)] }, 'graded'],
    ['ждём студента, а он ответил комментарием', { comments: [T(150), S(160)] }, 'student_comment'],
    [
      'на доработке, вопрос студента',
      { status: 'draft', comments: [T(150), S(160)] },
      'student_comment',
    ],
    ['черновик с вопросом до сдачи', { status: 'draft', comments: [S(90)] }, 'student_comment'],
    [
      'досылка не разобрана важнее комментария студента',
      { gradedAt: 50, comments: [S(120)] },
      'update_unreviewed',
    ],
  ])('%s', (_name, input, expected) => {
    expect(state(input)).toBe(expected);
  });
});
