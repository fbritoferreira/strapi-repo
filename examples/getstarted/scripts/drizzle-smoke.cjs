// Checks the Drizzle bridge against the getstarted app's sqlite database.
// Stop any running server first, then: node scripts/drizzle-smoke.cjs
const assert = require('node:assert/strict');
const { createStrapi, compileStrapi } = require('@strapi/strapi');
const { and, count, eq, isNotNull } = require('drizzle-orm');

const main = async () => {
  const app = await createStrapi(await compileStrapi()).load();
  const { client, table, tables } = app.db.drizzle;
  let failed = 0;

  const check = async (name, fn) => {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (err) {
      failed += 1;
      console.log(`FAIL ${name}: ${err.message}`);
    }
  };

  const articles = table('api::article.article');
  const categories = table('api::category.category');
  const link = tables.articles_categories_lnk;

  const article = await app.documents('api::article.article').create({
    data: { title: `drizzle-${Date.now()}` },
  });
  const category = await app.documents('api::category.category').create({
    data: { name: `drizzle-${Date.now()}`, articles: [article.documentId] },
  });

  await check('every content type and join table has a Drizzle table', async () => {
    assert.ok(articles && categories && link);
  });

  await check('select by column reads what the document service wrote', async () => {
    const rows = await client
      .select()
      .from(articles)
      .where(eq(articles.document_id, article.documentId));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, article.title);
    assert.ok(rows[0].created_at instanceof Date, 'datetime column should map to Date');
  });

  await check('join through the relation link table keeps same-named columns apart', async () => {
    const rows = await client
      .select({ articleId: articles.id, categoryId: categories.id, category: categories.name })
      .from(articles)
      .innerJoin(link, eq(link.article_id, articles.id))
      .innerJoin(categories, eq(categories.id, link.category_id))
      .where(eq(articles.document_id, article.documentId));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].category, category.name);
    assert.notEqual(rows[0].articleId, undefined);
    assert.notEqual(rows[0].categoryId, undefined);
  });

  await check('aggregate query (draft rows, published_at is null)', async () => {
    const [{ drafts }] = await client
      .select({ drafts: count() })
      .from(articles)
      .where(and(eq(articles.document_id, article.documentId)));
    const [{ published }] = await client
      .select({ published: count() })
      .from(articles)
      .where(and(eq(articles.document_id, article.documentId), isNotNull(articles.published_at)));
    assert.equal(drafts, 1);
    assert.equal(published, 0);
  });

  await check('drizzle writes roll back with strapi.db.transaction', async () => {
    const title = `rolled-back-${Date.now()}`;
    await assert.rejects(
      app.db.transaction(async () => {
        await client
          .update(articles)
          .set({ title })
          .where(eq(articles.document_id, article.documentId));
        throw new Error('abort');
      }),
      /abort/
    );
    const [row] = await client
      .select()
      .from(articles)
      .where(eq(articles.document_id, article.documentId));
    assert.equal(row.title, article.title);
  });

  await check(
    'drizzle writes inside a committed transaction are visible to the document service',
    async () => {
      const title = `committed-${Date.now()}`;
      await app.db.transaction(async () => {
        await client
          .update(articles)
          .set({ title })
          .where(eq(articles.document_id, article.documentId));
      });
      const doc = await app
        .documents('api::article.article')
        .findOne({ documentId: article.documentId });
      assert.equal(doc.title, title);
    }
  );

  await app.documents('api::category.category').delete({ documentId: category.documentId });
  await app.documents('api::article.article').delete({ documentId: article.documentId });
  await app.destroy();
  process.exit(failed ? 1 : 0);
};

main();
