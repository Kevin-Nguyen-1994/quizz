import { type NextFunction, type Request, type Response, Router } from 'express';
import {
  AssignmentServiceError,
  closeAssignment,
  createDraftAssignment,
  getAssignmentForAdmin,
  listAssignmentsForAdmin,
  publishAssignment,
  setAssignmentMembers,
  updateDraftAssignment,
} from '../assignmentService';
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

function handleError(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof AssignmentServiceError) {
    res.status(error.statusCode).json({ error: error.message });
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

assignmentAdminRouter.post(
  '/:id/publish',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const assignment = await publishAssignment(actor(req), assignmentId(req));
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
