import { Router, type IRouter } from "express";
import healthRouter from "./health";
import candidatesRouter from "./candidates";
import signalpilotRouter from "./signalpilot";

const router: IRouter = Router();

router.use(healthRouter);
router.use(candidatesRouter);
router.use(signalpilotRouter);

export default router;
