// Легаси-точка входа. Редизайн визуализатора (SPEC §16.15) перенёс фронт в модульную
// архитектуру: app.mjs + lib/{state,format,chart,api,palette}.mjs + panels/{stats,heatmap,
// zones,confirmation,lab,config}.mjs + styles.css. Этот файл сохранён, чтобы старые
// закладки/инструкции с прямой ссылкой на app.js не падали, и не используется index.html.
