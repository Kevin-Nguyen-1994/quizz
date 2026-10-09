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
  addPublishedAssignmentRecipients,
  revokeAssignmentRecipient,
  reassignAssignmentRecipient,
} from '../assignmentService';
import {
  buildAssignmentCsv,
  getAdminAttemptDetail,
  getAdminQuestionDetail,
  getAssignmentReport,
} from '../assignmentReporting';
import { getRequestUser, requireAuth } from '../middleware';
import { createAssignmentQuestionPreview, QuestionGenerationError } from '../questionGeneration';

export const assignmentAdminRouter = Router();

assignmentAdminRouter.use(requireAuth);

assignmentAdminRouter.post('/:id/recipients', async (req,res,next)=>{ try { const body=req.body as {userIds?:unknown;reason?:unknown}; if(!Array.isArray(body.userIds)) throw new AssignmentServiceError('userIds must be an array'); await addPublishedAssignmentRecipients(actor(req),assignmentId(req),body.userIds as number[],typeof body.reason==='string'?body.reason:undefined); res.status(204).end(); } catch(error){handleError(error,res,next);} });
assignmentAdminRouter.post('/:id/recipients/:userId/revoke', async (req,res,next)=>{ try { await revokeAssignmentRecipient(actor(req),assignmentId(req),Number(req.params.userId),(req.body as {reason?:unknown})?.reason as string|undefined); res.status(204).end(); } catch(error){handleError(error,res,next);} });
assignmentAdminRouter.post('/:id/recipients/:userId/reassign', async (req,res,next)=>{ try { await reassignAssignmentRecipient(actor(req),assignmentId(req),Number(req.params.userId),(req.body as {reason?:unknown})?.reason as string|undefined); res.status(204).end(); } catch(error){handleError(error,res,next);} });

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
  if (error instanceof QuestionGenerationError) {
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
  '/:id/question-preview',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ preview: await createAssignmentQuestionPreview(actor(req), assignmentId(req)) });
    } catch (error) {
      handleError(error, res, next);
    }
  },
);

assignmentAdminRouter.post(
  '/:id/publish',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as {
        fingerprint?: unknown;
        targetFingerprint?: unknown;
        questionFingerprint?: unknown;
      };
      for (const [name, value] of [
        ['fingerprint', body.fingerprint],
        ['targetFingerprint', body.targetFingerprint],
        ['questionFingerprint', body.questionFingerprint],
      ] as const) {
        if (value !== undefined && typeof value !== 'string') {
          throw new AssignmentServiceError(`${name} must be a string`);
        }
      }
      const assignment = await publishAssignment(actor(req), assignmentId(req), {
        targetFingerprint: (body.targetFingerprint ?? body.fingerprint) as string | undefined,
        questionFingerprint: body.questionFingerprint as string | undefined,
      });
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
