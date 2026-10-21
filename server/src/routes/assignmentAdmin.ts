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
  getAssignmentAnalytics,
  getAdminAttemptDetail,
  getAdminQuestionDetail,
  getAssignmentReport,
} from '../assignmentReporting';
import { applyResultAdjustment, previewAcceptedVariantTargets } from '../assessmentAdjustments';
import { getAdminAppeal, listAdminAppeals, transitionAppeal } from '../assignmentAppeals';
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
  '/:id/analytics',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await getAssignmentAnalytics(actor(req), assignmentId(req)));
    } catch (error) {
      handleError(error, res, next);
    }
  },
);

assignmentAdminRouter.get('/:id/appeals', async (req, res, next) => {
  try { res.json({ appeals: await listAdminAppeals(actor(req), assignmentId(req)) }); }
  catch (error) { handleError(error, res, next); }
});

assignmentAdminRouter.get('/:id/appeals/:appealId', async (req, res, next) => {
  try { res.json({ appeal: await getAdminAppeal(actor(req), assignmentId(req), positiveParam(req, 'appealId')) }); }
  catch (error) { handleError(error, res, next); }
});

assignmentAdminRouter.post('/:id/appeals/:appealId/start-review', async (req, res, next) => {
  try { await transitionAppeal(actor(req), assignmentId(req), positiveParam(req, 'appealId'), 'review'); res.status(204).end(); }
  catch (error) { handleError(error, res, next); }
});

assignmentAdminRouter.post('/:id/appeals/:appealId/resolve', async (req, res, next) => {
  try {
    const body = req.body as { outcome?: unknown; note?: unknown };
    if (body.outcome !== 'accepted_no_score_change' && body.outcome !== 'rejected') throw new AssignmentServiceError('Invalid resolution outcome');
    await transitionAppeal(actor(req), assignmentId(req), positiveParam(req, 'appealId'), body.outcome === 'rejected' ? 'reject' : 'accept', body.note);
    res.status(204).end();
  } catch (error) { handleError(error, res, next); }
});

assignmentAdminRouter.post(
  '/:id/adjustments/preview-accepted-variants',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as { assignmentQuestionId?: unknown; adjudicationPayload?: unknown };
      const questionId = Number(body.assignmentQuestionId);
      if (!Number.isInteger(questionId) || questionId < 1) throw new AssignmentServiceError('Invalid assignmentQuestionId');
      const id = assignmentId(req);
      await getAssignmentForAdmin(actor(req), id);
      res.json({ targets: await previewAcceptedVariantTargets(id, questionId, body.adjudicationPayload) });
    } catch (error) {
      handleError(error, res, next);
    }
  },
);

assignmentAdminRouter.post(
  '/:id/adjustments',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as Record<string, unknown>;
      const assignmentQuestionId = Number(body.assignmentQuestionId);
      if (!Number.isInteger(assignmentQuestionId) || assignmentQuestionId < 1) {
        throw new AssignmentServiceError('Invalid assignmentQuestionId');
      }
      const scope = body.scope;
      const reasonCode = body.reasonCode;
      const reasonText = body.reasonText;
      const source = body.source;
      const targets = body.targets;
      if (!['individual', 'question_regrade', 'full_credit_all'].includes(String(scope)) ||
          !['MISSING_ACCEPTED_ANSWER', 'WRONG_ANSWER_KEY', 'AMBIGUOUS_QUESTION', 'MANUAL_REVIEW', 'ADMIN_SCORE_CORRECTION'].includes(String(reasonCode)) ||
          !['employee_appeal', 'admin_review', 'analytics_flag'].includes(String(source)) ||
          typeof reasonText !== 'string' || !Array.isArray(targets)) {
        throw new AssignmentServiceError('Invalid adjustment payload');
      }
      const parsedTargets = targets.map((target) => {
        const value = target as Record<string, unknown>;
        return {
          attemptId: Number(value.attemptId),
          adjustedIsCorrect: value.adjustedIsCorrect === null ? null : Boolean(value.adjustedIsCorrect),
          adjustedScore: Number(value.adjustedScore),
        };
      });
      const appealId = body.appealId === undefined ? undefined : Number(body.appealId);
      if (appealId !== undefined && (!Number.isInteger(appealId) || appealId < 1)) throw new AssignmentServiceError('Invalid appealId');
      res.status(201).json(await applyResultAdjustment(actor(req), {
        assignmentId: assignmentId(req), assignmentQuestionId,
        scope: scope as 'individual' | 'question_regrade' | 'full_credit_all',
        reasonCode: reasonCode as 'MISSING_ACCEPTED_ANSWER' | 'WRONG_ANSWER_KEY' | 'AMBIGUOUS_QUESTION' | 'MANUAL_REVIEW' | 'ADMIN_SCORE_CORRECTION',
        reasonText, source: source as 'employee_appeal' | 'admin_review' | 'analytics_flag',
        adjudicationPayload: body.adjudicationPayload,
        targets: parsedTargets,
        expectedCurrentAdjustmentIds: body.expectedCurrentAdjustmentIds as Record<string, number | null> | undefined,
        supersedesBatchId: typeof body.supersedesBatchId === 'number' ? body.supersedesBatchId : null,
        appealId,
      }));
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
