import { type NextFunction, type Request, type Response, Router } from 'express';
import {
  AssignmentServiceError,
  closeAssignment,
  createDraftAssignment,
  getAssignmentForAdmin,
  listAssignmentsForAdmin,
  previewAssignmentTarget,
  publishAssignment,
  setAssignmentMembers,
  setAssignmentTargetOverrides,
  updateDraftAssignment,
} from '../assignmentService';
import {
  buildAssignmentCsv,
  getAdminAttemptDetail,
  getAdminQuestionDetail,
  getAssignmentReport,
} from '../assignmentReporting';
import { getRequestUser, requireAuth } from '../middleware';

export const assignmentAdminRouter = Router();

assignmentAdminRouter.use(requireAuth);

function actor(req: Request) {
  const user = getRequestUser(req);
  if (!user) throw new AssignmentServiceError('Unauthorized', 401);
  return user;
}

function assignmentId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new AssignmentServiceError('Invalid assignment id');
  return id;
}

function positiveParam(req: Request, name: string): number {
  const value = Number(req.params[name]);
  if (!Number.isInteger(value) || value < 1) {
    throw new AssignmentServiceError(`Invalid ${name}`);
  }
  return value;
}

function handleError(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof AssignmentServiceError) {
    res.status(error.statusCode).json({
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.details === undefined ? {} : { details: error.details }),
    });
    return;
  }
  next(error);
}

assignmentAdminRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const assignment = await createDraftAssignment(actor(req), req.body);
    res.status(201).json({ assignment });
  } catch (error) {
    handleError(error, res, next);
  }
});

assignmentAdminRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ assignments: await listAssignmentsForAdmin(actor(req)) });
  } catch (error) {
    handleError(error, res, next);
  }
});

assignmentAdminRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getAssignmentForAdmin(actor(req), assignmentId(req)));
  } catch (error) {
    handleError(error, res, next);
  }
});

assignmentAdminRouter.get(
  '/:id/report',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await getAssignmentReport(actor(req), assignmentId(req)));
    } catch (error) {
      handleError(error, res, next);
    }
  },
);

assignmentAdminRouter.get(
  '/:id/attempts/:attemptId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(
        await getAdminAttemptDetail(actor(req), assignmentId(req), positiveParam(req, 'attemptId')),
      );
    } catch (error) {
      handleError(error, res, next);
    }
  },
);

assignmentAdminRouter.get(
  '/:id/questions/:questionId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(
        await getAdminQuestionDetail(
          actor(req),
          assignmentId(req),
          positiveParam(req, 'questionId'),
        ),
      );
    } catch (error) {
      handleError(error, res, next);
    }
  },
);

assignmentAdminRouter.get(
  '/:id/export.csv',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const csv = await buildAssignmentCsv(actor(req), assignmentId(req));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${csv.filename}"`);
      res.send(csv.body);
    } catch (error) {
      handleError(error, res, next);
    }
  },
);

assignmentAdminRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const assignment = await updateDraftAssignment(actor(req), assignmentId(req), req.body);
    res.json({ assignment });
  } catch (error) {
    handleError(error, res, next);
  }
});

assignmentAdminRouter.put(
  '/:id/members',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userIds = (req.body as { userIds?: unknown }).userIds;
      if (!Array.isArray(userIds)) throw new AssignmentServiceError('userIds must be an array');
      const members = await setAssignmentMembers(
        actor(req),
        assignmentId(req),
        userIds as number[],
      );
      res.json({ members });
    } catch (error) {
      handleError(error, res, next);
    }
  },
);

assignmentAdminRouter.put(
  '/:id/target-overrides',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const overrides = (req.body as { overrides?: unknown }).overrides;
      if (!Array.isArray(overrides)) {
        throw new AssignmentServiceError('overrides must be an array');
      }
      res.json({
        overrides: await setAssignmentTargetOverrides(actor(req), assignmentId(req), overrides),
      });
    } catch (error) {
      handleError(error, res, next);
    }
  },
);

assignmentAdminRouter.post(
  '/:id/target-preview',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ preview: await previewAssignmentTarget(actor(req), assignmentId(req)) });
    } catch (error) {
      handleError(error, res, next);
    }
  },
);

assignmentAdminRouter.post(
  '/:id/publish',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const fingerprint = (req.body as { fingerprint?: unknown }).fingerprint;
      if (fingerprint !== undefined && typeof fingerprint !== 'string') {
        throw new AssignmentServiceError('fingerprint must be a string');
      }
      const assignment = await publishAssignment(
        actor(req),
        assignmentId(req),
        fingerprint as string | undefined,
      );
      res.json({ assignment });
    } catch (error) {
      handleError(error, res, next);
    }
  },
);

assignmentAdminRouter.post(
  '/:id/close',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const assignment = await closeAssignment(actor(req), assignmentId(req));
      res.json({ assignment });
    } catch (error) {
      handleError(error, res, next);
    }
  },
);
