import { type Actor, Role, toUserId } from "@src/shared/domain/actor";
import { aTask, aWorksite } from "../../../../support/worksite.builder";

const linda: Actor = { id: toUserId("00000000-0000-4000-8000-000000000001"), role: Role.SITE_SUPERVISOR };
const mark: Actor = { id: toUserId("00000000-0000-4000-8000-000000000002"), role: Role.FOREMAN };
const henry: Actor = { id: toUserId("00000000-0000-4000-8000-000000000003"), role: Role.FOREMAN };
const otherForeman: Actor = { id: toUserId("00000000-0000-4000-8000-000000000004"), role: Role.FOREMAN };

const foundation = aTask().named("Pour foundation").assignedTo(mark.id).withApprovedProgress(100).build();
const walls = aTask().named("Build ground-floor walls").assignedTo(mark.id).withApprovedProgress(40).build();
const electrical = aTask().named("Install electrical").assignedTo(henry.id).build();

const townhouse = aWorksite().supervisedBy(linda.id).withTasks(foundation, walls, electrical).build();

describe("Worksite.tasksVisibleTo (FR-008a)", () => {
  it("gives a site supervisor every task, in order", () => {
    expect(townhouse.tasksVisibleTo(linda)).toEqual([foundation, walls, electrical]);
  });

  it("gives a foreman only the tasks assigned to them, in order", () => {
    expect(townhouse.tasksVisibleTo(mark)).toEqual([foundation, walls]);
    expect(townhouse.tasksVisibleTo(henry)).toEqual([electrical]);
  });

  it("gives a foreman with no tasks in the worksite an empty list", () => {
    expect(townhouse.tasksVisibleTo(otherForeman)).toEqual([]);
  });

  it("gives both roles an empty list for a worksite with no tasks", () => {
    const empty = aWorksite().supervisedBy(linda.id).build();

    expect(empty.tasksVisibleTo(linda)).toEqual([]);
    expect(empty.tasksVisibleTo(mark)).toEqual([]);
  });

  it("throws for a role outside the glossary, such as one read from bad stored data", () => {
    const unknownRole: Actor = { id: linda.id, role: "ADMIN" as never };

    expect(() => townhouse.tasksVisibleTo(unknownRole)).toThrow("Unexpected value: ADMIN");
  });
});
