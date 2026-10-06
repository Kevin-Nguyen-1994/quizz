import { type NextFunction, type Request, type Response, Router } from 'express';
import {
  createEmployeeLevel,
  EmployeeLevelError,
  listEmployeeLevels,
  updateEmployeeLevel,
} from '../employeeLevels';
import { getRequestUser, requireAuth, requireSuperAdmin } from '../middleware';

export const employeeLevelsRouter = Router();

function handleError(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof EmployeeLevelError) {
    res.status(error.statusCode).json({ error: error.message, code: error.code });
    return;
  }
  next(error);
}

employeeLevelsRouter.get('/', requireAuth, async (req: Request, res: Response, next) => {
  try {
    const includeInactive = getRequestUser(req)?.role === 'super_admin';
    res.json({ levels: await listEmployeeLevels(includeInactive) });
  } catch (error) {
    handleError(error, res, next);
  }
});

employeeLevelsRouter.post('/', requireSuperAdmin, async (req: Request, res: Response, next) => {
  try {
    res.status(201).json({ level: await createEmployeeLevel(req.body ?? {}) });
  } catch (error) {
    handleError(error, res, next);
  }
});

employeeLevelsRouter.patch('/:id', requireSuperAdmin, async (req: Request, res: Response, next) => {
  try {
    const levelId = Number(req.params.id);
    if (!Number.isInteger(levelId) || levelId < 1) {
      throw new EmployeeLevelError('Invalid employee level id');
    }
    res.json({ level: await updateEmployeeLevel(levelId, req.body ?? {}) });
  } catch (error) {
    handleError(error, res, next);
  }
});
