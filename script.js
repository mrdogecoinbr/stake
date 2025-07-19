const inputID = document.getElementById("telegram_id");
const dias = document.getElementById("dias");
const resultado = document.getElementById("resultado");
const adicionarBtn = document.getElementById("adicionar");
const limparBtn = document.getElementById("limpar");

let users = {};

adicionarBtn.onclick = () => {
  const id = inputID.value.trim();
  const qtdDias = parseInt(dias.value);
  if (!id) return alert("Informe o ID do Telegram!");

  const now = new Date();
  const expiracao = new Date();
  expiracao.setDate(now.getDate() + qtdDias);

  users[id] = {
    id: parseInt(id),
    expires: qtdDias === 9999 ? "never" : expiracao.toISOString().split("T")[0]
  };

  atualizarJSON();
};

limparBtn.onclick = () => {
  if (confirm("Tem certeza que deseja limpar todos os dados?")) {
    users = {};
    atualizarJSON();
  }
};

function atualizarJSON() {
  resultado.value = JSON.stringify(users, null, 2);
}
