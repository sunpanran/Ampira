import assert from "node:assert/strict";
import { createBookmarksView } from "../../assets/client/bookmarks-view.mjs";
import { bookmarkEmptyStateKind } from "../../assets/client/empty-state-policy.mjs";
import { hideBookmarkCategory } from "../../assets/client/bookmark-visibility.mjs";

export function runBookmarkFilterTests() {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const doc = { activeElement: null, createElement: createNode };
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  try {
    const category = (name) => ({ name, categoryKey: `category:${name}` });
    const section = { name: "News", sectionKey: "news", categories: [category("Tech"), category("Art"), category("Empty")] };
    const bookmark = (name, extra = {}) => ({ section: "News", category: name, ...extra });
    const initialBookmarks = [bookmark("Tech"), bookmark("Art"), bookmark("Empty", { section: "Other" })];
    const state = { filter: "News", categoryFilter: "all", settings: {}, data: { sections: [section], bookmarks: initialBookmarks } };
    const categoryFilter = { replaceChildren(...nodes) { this.options = nodes; } };
    const control = { contains: (node) => node === categoryFilter };
    const focused = [];
    const categoryGrid = { classList: { toggle() {} }, replaceChildren(...nodes) { this.children = nodes; } };
    const view = createBookmarksView({
      state, allFilter: "all", t: (key) => key,
      els: { categoryFilter, categoryFilterControl: control, categoryGrid,
        sectionFilter: { querySelector: () => ({ focus: () => focused.push("section") }) } },
      groupItemsByKey: (items, key) => {
        const groups = new Map();
        for (const item of items) groups.set(key(item), [...(groups.get(key(item)) || []), item]);
        return groups;
      },
      createEmptyState: (options) => options,
    });
    const values = () => categoryFilter.options.map((option) => option.value);

    view.renderCategoryFilters();
    assert.deepEqual(values(), ["all", "Tech", "Art"], "empty folders and another section's bookmarks must not produce filter options");
    assert.equal(control.hidden, false);
    assert.equal(categoryFilter.disabled, false);
    state.categoryFilter = "Art";
    view.renderCategoryFilters();
    assert.equal(categoryFilter.value, "Art", "a valid selection survives a data rerender");

    state.settings.hiddenBookmarkCategories = hideBookmarkCategory({}, "News", "Tech", "news", "category:Tech");
    doc.activeElement = categoryFilter;
    view.renderCategoryFilters();
    assert.deepEqual(values(), ["all", "Art"]);
    assert.equal(control.hidden, true, "one effective category needs no filter control");
    assert.equal(categoryFilter.disabled, true, "a hidden control must close its popup and leave keyboard navigation");
    assert.equal(state.categoryFilter, "all", "a disappearing filter must not leave an invisible selection active");
    assert.deepEqual(focused, ["section"], "focus returns to the main filter when the dropdown disappears");
    doc.activeElement = null;

    state.settings = {};
    state.categoryFilter = "Removed";
    view.renderCategoryFilters();
    assert.equal(categoryFilter.value, "all", "a deleted or renamed category resets to all");
    state.filter = "all";
    state.categoryFilter = "Tech";
    view.renderCategoryFilters();
    assert.deepEqual(values(), ["all"]);
    assert.equal(control.hidden, true);
    assert.equal(state.categoryFilter, "all", "All clears any previous subcategory");

    state.filter = "News";
    state.data.bookmarks = [bookmark("Tech"), bookmark("Tech"), bookmark("Art", { sourceKind: "preset", cardType: "inspiration" })];
    view.renderCategoryFilters();
    assert.deepEqual(values(), ["all", "Tech"], "preset content must not make an archive category selectable");
    assert.equal(control.hidden, true);
    state.data.bookmarks = initialBookmarks;
    section.categories.push(category("Tech"));
    view.renderCategoryFilters();
    assert.deepEqual(values(), ["all", "Tech", "Art"], "duplicate folder labels must not add duplicate options");

    state.data.bookmarks = [];
    state.categoryFilter = "Tech";
    view.renderCategoryFilters();
    view.renderCategories();
    assert.equal(control.hidden, true);
    assert.equal(state.categoryFilter, "all");
    assert.equal(categoryGrid.children[0].title, "empty.emptySection.title", "an empty selected group explains its empty content");
    state.filter = "all";
    view.renderCategoryFilters();
    view.renderCategories();
    assert.equal(categoryGrid.children[0].title, "empty.noEntries.title", "the global empty state retains its source setup guidance");

    state.filter = "News";
    state.data.bookmarks = [bookmark("Tech")];
    state.settings.hiddenBookmarkCategories = hideBookmarkCategory({}, "News", "Tech", "news", "category:Tech");
    view.renderCategoryFilters();
    view.renderCategories();
    assert.equal(categoryGrid.children[0].title, "empty.hiddenCategories.title", "unused empty folders must not mask recovery for hidden populated categories");
    assert.equal(categoryGrid.children[0].actionLabel, "context.bookmarkSettings");
    assert.equal(bookmarkEmptyStateKind({ emptySection: true, allCategoriesHidden: true }), "hiddenCategories");
    assert.equal(bookmarkEmptyStateKind({ emptySection: true, query: "sample" }), "noMatches");
    testBookmarkGroupLabels();
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else delete globalThis.document;
  }
}

function testBookmarkGroupLabels() {
  const state = {
    filter: "all", categoryFilter: "all", settings: {}, seen: new Set(), opened: new Set(),
    data: {
      sections: [
        { name: "News", categories: [{ name: "Tech" }, { name: "Science" }] },
        { name: "Inspiration", categories: [{ name: "Design" }] },
      ],
      bookmarks: [
        { key: "tech", section: "News", category: "Tech", title: "Tech sample", url: "https://example.com/tech" },
        { key: "science", section: "News", category: "Science", title: "Science sample", url: "https://example.com/science" },
        { key: "design", section: "Inspiration", category: "Design", title: "Design sample", url: "https://example.com/design" },
      ],
    },
  };
  const grid = createNode();
  const view = createBookmarksView({
    state, els: { categoryGrid: grid }, allFilter: "all", t: key => key,
    groupItemsByKey: (items, key) => {
      const groups = new Map();
      for (const item of items) groups.set(key(item), [...(groups.get(key(item)) || []), item]);
      return groups;
    },
    createIcon: createNode, createThemedIcon: createNode, srOnly: createNode,
    cardIconName: () => "news", cardTone: () => "news", faviconUrl: () => "favicon.svg",
    contextAttachGroup() {}, contextAttachLink() {}, defaultSeenSource: () => "bookmark", actionKey: item => item.key,
  });
  const titles = () => grid.children.map(card => card.children[0].children[0]);
  const sources = () => titles().flatMap(title => title.children.filter(node => node.className?.startsWith("pill ")).map(node => node.textContent));
  view.renderCategories();
  assert.deepEqual(sources(), ["News", "News", "Inspiration"], "All retains the group labels needed to distinguish bookmark sources");
  state.filter = "News";
  view.renderCategories();
  assert.deepEqual(sources(), [], "a selected main group omits its repeated source labels");
  assert.deepEqual(titles().map(title => title.children[1].textContent), ["Tech", "Science"], "group order remains stable after filtering");
  state.categoryFilter = "Tech";
  view.renderCategories();
  assert.equal(grid.children.length, 1);
  assert.deepEqual(sources(), [], "subcategory selection also avoids a redundant main group label");
  state.filter = "all";
  state.categoryFilter = "all";
  view.renderCategories();
  assert.deepEqual(sources(), ["News", "News", "Inspiration"], "returning to All restores the source labels");
}

function createNode() {
  return {
    children: [], dataset: {}, classList: { toggle() {} },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    setAttribute() {}, addEventListener() {},
  };
}
