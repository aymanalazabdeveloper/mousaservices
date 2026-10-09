const form = document.getElementById("requestForm");
const button = document.getElementById("submitBtn");
const result = document.getElementById("result");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  button.disabled = true;
  button.textContent = "جاري إرسال الطلب...";
  result.hidden = true;

  try {
    const formData = new FormData(form);
    const selectedFiles = document.getElementById("attachments").files;
    if (selectedFiles.length > 5) throw new Error("الحد الأقصى هو 5 مرفقات لكل طلب.");
    for (const file of selectedFiles) {
      if (file.size > 5 * 1024 * 1024) throw new Error(`الملف ${file.name} أكبر من 5 ميجابايت.`);
    }
    const response = await fetch("/api/requests", {
      method: "POST",
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "تعذر إرسال الطلب.");
    }

    const requestId = data?.request?.id;
    if (!requestId) throw new Error("تم إرسال الطلب، لكن لم يصل رقم الطلب من الخادم.");

    form.reset();
    window.location.href = `/success.html?id=${encodeURIComponent(requestId)}`;
  } catch (error) {
    result.className = "form-result error";
    result.textContent = error.message;
    result.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = "إرسال الطلب";
  }
});
