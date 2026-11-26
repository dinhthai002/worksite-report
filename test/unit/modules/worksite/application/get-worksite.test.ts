import { GetWorksite } from "@src/modules/worksite/application/get-worksite";
import { toWorksiteId } from "@src/modules/worksite/domain/worksite";
import { type Actor, Role, toUserId } from "@src/shared/domain/actor";
import { NotFoundError } from "@src/shared/domain/errors";
import { InMemoryWorksiteRepository } from "../../../../fakes/in-memory-worksite.repository";
import { aTask, aWorksite } from "../../../../support/worksite.builder";

const TOWNHOUSE_ID = "00000000-0000-4000-8000-000000000101";
const linda: Actor = { id: toUserId("00000000-0000-4000-8000-000000000001"), role: Role.SITE_SUPERVISOR };
const mark: Actor = { id: toUserId("00000000-0000-4000-8000-000000000002"), role: Role.FOREMAN };
const henry: Actor = { id: toUserId("00000000-0000-4000-8000-000000000003"), role: Role.FOREMAN };

const walls = aTask()
  .withId("00000000-0000-4000-8000-000000000202")
  .named("Build ground-floor walls")
  .assignedTo(mark.id)
  .withApprovedProgress(40)
  .build();
const electrical = aTask()
  .withId("00000000-0000-4000-8000-000000000203")
  .named("Install electrical")
  .assignedTo(henry.id)
  .build();
const townhouse = aWorksite().withId(TOWNHOUSE_ID).supervisedBy(linda.id).withTasks(walls, electrical).build();

describe("GetWorksite", () => {
  const getWorksite = new GetWorksite(new InMemoryWorksiteRepository([townhouse]));

  it("returns the worksite and every task to a site supervisor, with user IDs only", async () => {
    const view = await getWorksite.execute({ worksiteId: toWorksiteId(TOWNHOUSE_ID), actor: linda });

    expect(view).toEqual({
      id: TOWNHOUSE_ID,
      name: "Three-storey townhouse",
      status: "ACTIVE",
      supervisorId: linda.id,
      tasks: [
        { id: walls.id, name: "Build ground-floor walls", assigneeId: mark.id, approvedProgress: 40 },
        { id: electrical.id, name: "Install electrical", assigneeId: henry.id, approvedProgress: 0 },
      ],
    });
  });

  it("returns only a foreman's own tasks", async () => {
    const view = await getWorksite.execute({ worksiteId: toWorksiteId(TOWNHOUSE_ID), actor: henry });

    expect(view.tasks.map((task) => task.id)).toEqual([electrical.id]);
  });

  it("throws WORKSITE_NOT_FOUND naming an unknown ID", async () => {
    const unknownId = "00000000-0000-4000-8000-000000000999";

    const result = getWorksite.execute({ worksiteId: toWorksiteId(unknownId), actor: linda });

    await expect(result).rejects.toThrow(NotFoundError);
    await expect(result).rejects.toMatchObject({
      code: "WORKSITE_NOT_FOUND",
      message: `There is no worksite with ID ${unknownId}.`,
      details: { worksiteId: unknownId },
    });
  });
});
