import { type NextFunction, type Request, type Response, Router } from 'express';
import {
  AssignmentServiceError,
  completeAssignmentAttempt,
  getParticipantAttemptState,
  lookupParticipantAssignment,
  startOrResumeAttempt,
  submitAssignmentAnswer,
  timeoutAssignmentQuestion,
} from '../assignmentService';
import { getRequestUser, requireAuth } from '../middleware';

export const assignmentsRouter = Router();

assignmentsRouter.use(requireAuth);

function participantId(req: Request): number {
  const user = getRequestUser(req);
  if (!user || user.role !== 'user') {
    throw new AssignmentServiceError('User accounts only', 403);
  }
  return user.id;
}

function attemptId(req: Request): number {
  const id = Number(req.params.attemptId);
  if (!Number.isInteger(id) || id < 1) throw new AssignmentServiceError('Invalid attempt id');
  return id;
}

function accessCode(req: Request): string {
  const value = req.params.accessCode;
  if (typeof value !== 'string' || !value) {
    throw new AssignmentServiceError('Invalid access code');
  }
  return value;
}

function handleError(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof AssignmentServiceError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  next(error);
}

assignmentsRouter.get(
  '/attempts/:attemptId/current',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await getParticipantAttemptState(attemptId(req), participantId(req)));
    } catch (error) {
      handleError(error, res, next);
    }
  },
);

assignmentsRouter.post(
  '/attempts/:attemptId/answers',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { questionId, chosenIndex, chosenIndices, chosenText } = req.body as {
        questionId?: number;
        chosenIndex?: number | null;
        chosenIndices?: Array<number | null>;
        chosenText?: string | null;
      };
      if (!Number.isInteger(questionId) || (questionId as number) < 1) {
        throw new AssignmentServiceError('questionId is invalid');
      }
      res.json(
        await submitAssignmentAnswer(attemptId(req), participantId(req), questionId as number, {
          chosenIndex,
          chosenIndices,
          chosenText,
        }),
      );
    } catch (error) {
      handleError(error, res, next);
    }
  },
);

assignmentsRouter.post(
  '/attempts/:attemptId/timeout',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await timeoutAssignmentQuestion(attemptId(req), participantId(req)));
    } catch (error) {
      handleError(error, res, next);
    }
  },
);

assignmentsRouter.post(
  '/attempts/:attemptId/complete',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await completeAssignmentAttempt(attemptId(req), participantId(req)));
    } catch (error) {
      handleError(error, res, next);
    }
  },
);

assignmentsRouter.get('/:accessCode', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await lookupParticipantAssignment(accessCode(req), participantId(req)));
  } catch (error) {
    handleError(error, res, next);
  }
});

assignmentsRouter.post(
  '/:accessCode/start',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await startOrResumeAttempt(accessCode(req), participantId(req)));
    } catch (error) {
      handleError(error, res, next);
    }
  },
);
