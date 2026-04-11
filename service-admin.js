const { AppError } = require("./lib-errors");
const { VALID_ROLES, VALID_USER_STATUSES } = require("./portal-defaults");

const sanitizeUser = (user) => ({
  id: user.id,
  username: user.username,
  displayName: user.displayName,
  email: user.email,
  role: user.role,
  status: user.status,
  createdAt: user.createdAt,
  lastLoginAt: user.lastLoginAt
});

const countActiveAdmins = (users, excludedUserId = null, patch = null) =>
  users.filter((user) => {
    const candidate =
      user.id === excludedUserId && patch
        ? {
            ...user,
            ...patch
          }
        : user;

    return candidate.role === "admin" && candidate.status === "active";
  }).length;

const createAdminService = ({ store }) => {
  const listUsers = () =>
    store
      .listUsers()
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .map((user) => sanitizeUser(user));

  const updateUser = async (userId, payload, actorUser) => {
    const patch = {};

    if (payload.role !== undefined) {
      if (!VALID_ROLES.includes(payload.role) || payload.role === "guest") {
        throw new AppError(400, "角色不合法。");
      }
      patch.role = payload.role;
    }

    if (payload.status !== undefined) {
      if (!VALID_USER_STATUSES.includes(payload.status)) {
        throw new AppError(400, "账号状态不合法。");
      }
      patch.status = payload.status;
    }

    if (!Object.keys(patch).length) {
      throw new AppError(400, "没有可更新的用户字段。");
    }

    const targetUser = store.findUserById(userId);
    if (!targetUser) {
      throw new AppError(404, "用户不存在。");
    }

    if (actorUser.id === userId) {
      if (patch.role && patch.role !== "admin") {
        throw new AppError(400, "不能在当前会话中移除自己的管理员权限。");
      }

      if (patch.status && patch.status !== "active") {
        throw new AppError(400, "不能在当前会话中停用自己的账号。");
      }
    }

    const users = store.listUsers();
    const activeAdminCount = countActiveAdmins(users, userId, patch);
    if (activeAdminCount < 1) {
      throw new AppError(400, "系统至少需要保留一个可用的管理员账号。");
    }

    const updatedUser = await store.updateUser(userId, patch);

    return {
      message: `已更新 ${updatedUser.displayName} 的账号配置。`,
      user: sanitizeUser(updatedUser)
    };
  };

  const deleteUser = async (userId, actorUser) => {
    const targetUser = store.findUserById(userId);
    if (!targetUser) {
      throw new AppError(404, "用户不存在。");
    }

    if (actorUser.id === userId) {
      throw new AppError(400, "不能删除当前登录中的管理员账号。");
    }

    const users = store.listUsers();
    const activeAdminsAfterDelete = users.filter(
      (user) => user.id !== userId && user.role === "admin" && user.status === "active"
    ).length;
    if (activeAdminsAfterDelete < 1) {
      throw new AppError(400, "系统至少需要保留一个可用的管理员账号。");
    }

    const deletedUser = await store.deleteUser(userId);

    return {
      message: `已删除用户 ${deletedUser.displayName}。`
    };
  };

  return {
    deleteUser,
    listUsers,
    updateUser
  };
};

module.exports = {
  createAdminService
};
