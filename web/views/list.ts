import { type Ctx } from "../ctx";
import { projectionView } from "./projection";
export function listView(ctx: Ctx) {
  return projectionView(ctx, "current");
}
