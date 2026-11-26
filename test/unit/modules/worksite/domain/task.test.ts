import { toUserId } from "@src/shared/domain/actor";
import { aTask } from "../../../../support/worksite.builder";

const MARK = toUserId("00000000-0000-4000-8000-000000000002");
const HENRY = toUserId("00000000-0000-4000-8000-000000000003");

describe("Task.isAssignedTo", () => {
  it("is true for the assignee", () => {
    const task = aTask().assignedTo(MARK).build();

    expect(task.isAssignedTo(MARK)).toBe(true);
  });

  it("is false for anyone else", () => {
    const task = aTask().assignedTo(MARK).build();

    expect(task.isAssignedTo(HENRY)).toBe(false);
  });
});
