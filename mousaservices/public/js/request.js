const form = document.getElementById("requestForm");
const button = document.getElementById("submitBtn");
const result = document.getElementById("result");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  button.disabled = true;
  button.textContent = "جاري إرسال الطلب...";
  result.hidden = true;

  try {
    const response = await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "تعذر إرسال الطلب.");
    }

    result.className = "form-result success";
    result.innerHTML = `
      <strong>تم تقديم الطلب بنجاح</strong>
      <span>رقم الطلب: <b>${data.request.id}</b></span>
      <span>احتفظ برقم الطلب لمتابعة حالته.</span>
      <a href="/track.html?id=${encodeURIComponent(data.request.id)}">متابعة الطلب</a>
    `;
    result.hidden = false;
    form.reset();
  } catch (error) {
    result.className = "form-result error";
    result.textContent = error.message;
    result.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = "إرسال الطلب";
  }
});
