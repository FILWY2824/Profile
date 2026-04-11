import { api } from "./front-api.js";
import { AUTH_TITLES } from "./front-config.js";

const setFeedback = (element, message, type = "success") => {
  if (!message) {
    element.textContent = "";
    element.className = "inline-feedback hidden";
    return;
  }

  element.textContent = message;
  element.className = `inline-feedback is-${type}`;
};

const withButtonBusy = async (button, action) => {
  button.disabled = true;
  try {
    await action();
  } finally {
    button.disabled = false;
  }
};

const createCooldownController = (button, initialLabel) => {
  let timerId = null;

  const setLabel = (text) => {
    button.textContent = text;
  };

  const reset = () => {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }

    button.disabled = false;
    setLabel(initialLabel);
  };

  const start = (seconds = 60) => {
    let remaining = seconds;

    if (timerId) {
      clearInterval(timerId);
    }

    button.disabled = true;
    setLabel(`重新发送（${remaining}s）`);

    timerId = setInterval(() => {
      remaining -= 1;

      if (remaining <= 0) {
        clearInterval(timerId);
        timerId = null;
        button.disabled = false;
        setLabel("重新发送验证码");
        return;
      }

      setLabel(`重新发送（${remaining}s）`);
    }, 1000);
  };

  return {
    reset,
    start
  };
};

export const createAuthController = ({ elements, onSignedIn, onSignedOut }) => {
  const registerCooldown = createCooldownController(elements.sendRegisterCodeButton, "发送验证码");
  const resetCooldown = createCooldownController(elements.sendResetCodeButton, "发送验证码");

  const close = () => {
    elements.modal.classList.add("hidden");
    elements.modal.setAttribute("aria-hidden", "true");
    elements.loginForm.reset();
    elements.registerForm.reset();
    elements.resetForm.reset();
    registerCooldown.reset();
    resetCooldown.reset();
    setFeedback(elements.message, "");
  };

  const switchMode = (mode) => {
    elements.title.textContent = AUTH_TITLES[mode];
    elements.tabLogin.classList.toggle("is-active", mode === "login");
    elements.tabRegister.classList.toggle("is-active", mode === "register");
    elements.loginForm.classList.toggle("hidden", mode !== "login");
    elements.registerForm.classList.toggle("hidden", mode !== "register");
    elements.resetForm.classList.toggle("hidden", mode !== "reset");
    elements.tabs.classList.toggle("hidden", mode === "reset");
    setFeedback(elements.message, "");
  };

  const open = (mode, options = {}) => {
    elements.modal.classList.remove("hidden");
    elements.modal.setAttribute("aria-hidden", "false");
    switchMode(mode);

    if (mode === "reset" && options.prefillEmail) {
      elements.resetEmail.value = options.prefillEmail;
    }
  };

  elements.closeButton.addEventListener("click", close);
  elements.tabLogin.addEventListener("click", () => switchMode("login"));
  elements.tabRegister.addEventListener("click", () => switchMode("register"));
  elements.openResetInline.addEventListener("click", () => switchMode("reset"));
  elements.backToLoginInline.addEventListener("click", () => switchMode("login"));
  elements.modal.addEventListener("click", (event) => {
    if (event.target instanceof HTMLElement && event.target.dataset.closeModal === "true") {
      close();
    }
  });

  elements.sendRegisterCodeButton.addEventListener("click", async () => {
    await withButtonBusy(elements.sendRegisterCodeButton, async () => {
      setFeedback(elements.message, "");

      try {
        const response = await api.requestRegisterCode({
          username: elements.registerUsername.value.trim(),
          email: elements.registerEmail.value.trim(),
          password: elements.registerPassword.value
        });

        setFeedback(elements.message, response.message, "success");
        registerCooldown.start(60);
      } catch (error) {
        setFeedback(elements.message, error.message, "error");
      }
    });
  });

  elements.sendResetCodeButton.addEventListener("click", async () => {
    await withButtonBusy(elements.sendResetCodeButton, async () => {
      setFeedback(elements.message, "");

      try {
        const response = await api.requestPasswordReset({
          email: elements.resetEmail.value.trim()
        });

        setFeedback(elements.message, response.message, "success");
        resetCooldown.start(60);
      } catch (error) {
        setFeedback(elements.message, error.message, "error");
      }
    });
  });

  elements.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = elements.loginForm.querySelector(".form-submit");

    await withButtonBusy(submitButton, async () => {
      setFeedback(elements.message, "");

      try {
        const response = await api.login({
          account: elements.loginAccount.value.trim(),
          password: elements.loginPassword.value
        });

        close();
        await onSignedIn(response.user);
      } catch (error) {
        setFeedback(elements.message, error.message, "error");
      }
    });
  });

  elements.registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = elements.registerForm.querySelector(".form-submit");

    await withButtonBusy(submitButton, async () => {
      setFeedback(elements.message, "");

      try {
        const response = await api.verifyRegisterCode({
          email: elements.registerEmail.value.trim(),
          code: elements.registerCode.value.trim()
        });

        close();
        await onSignedIn(response.user);
      } catch (error) {
        setFeedback(elements.message, error.message, "error");
      }
    });
  });

  elements.resetForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = elements.resetForm.querySelector(".form-submit");

    await withButtonBusy(submitButton, async () => {
      setFeedback(elements.message, "");
      const email = elements.resetEmail.value.trim();

      try {
        const response = await api.resetPassword({
          email,
          code: elements.resetCode.value.trim(),
          newPassword: elements.resetPassword.value
        });

        setFeedback(elements.message, response.message, "success");
        switchMode("login");
        elements.loginAccount.value = email;

        if (onSignedOut) {
          await onSignedOut();
        }
      } catch (error) {
        setFeedback(elements.message, error.message, "error");
      }
    });
  });

  return {
    close,
    open,
    switchMode
  };
};
