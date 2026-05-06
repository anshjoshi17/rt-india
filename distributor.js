// distributor.js
async function distributeArticle(record, supabase) {
  if (!record) {
    return { success: false, skipped: true, reason: "No record provided" };
  }

  // Put your real distribution logic here later.
  // For now, this prevents Render from crashing.
  return {
    success: true,
    skipped: false,
    message: "Distribution stub executed"
  };
}

module.exports = { distributeArticle };