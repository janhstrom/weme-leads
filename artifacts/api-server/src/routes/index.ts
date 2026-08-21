import { Router, type IRouter } from "express";
import healthRouter from "./health";
import signalpilotRouter from "./signalpilot";

const router: IRouter = Router();

router.use(healthRouter);
router.use(signalpilotRouter);

export default router;
