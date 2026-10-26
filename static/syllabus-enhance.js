/**
 * syllabus-enhance.js — curriculum prerequisite graph and progress dashboard.
 *
 * A marked YAML specification followed by one plain course table is the
 * authoring format. Earlier fenced-div and JSON/table documents still work.
 */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var COMPLETED_VALUES = new Set(['1', 'done', 'true', 'yes', 'x']);
  var MAX_GROUP_ALLOCATION_ATTEMPTS = 2000;
  var trackedDags = [];
  var dagDisposers = new WeakMap();
  var nextAppId = 0;
  var DEPTH_HUES = { parents: [255, 220, 185, 155], children: [55, 38, 20, 0] };

  function text(value) {
    return String(value === undefined || value === null ? '' : value).trim();
  }

  function splitList(value) {
    return text(value).split(/\s*,\s*/).filter(Boolean);
  }

  function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function addIssue(collection, message) {
    if (collection.indexOf(message) === -1) collection.push(message);
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function titleCase(value) {
    return text(value).replace(/-/g, ' ').replace(/\b\w/g, function (letter) {
      return letter.toUpperCase();
    });
  }

  function addCandidate(candidates, value) {
    var candidate = text(value);
    if (candidate && candidates.indexOf(candidate) === -1) candidates.push(candidate);
  }

  function withoutHtmlExtension(value) {
    return String(value || '').replace(/\.html?$/i, '');
  }

  function identifierCandidates(value) {
    var candidates = [];
    var raw = text(value);
    addCandidate(candidates, raw);
    try { addCandidate(candidates, decodeURIComponent(raw)); } catch (error) { /* ignore */ }

    var noQuery = raw.split('#')[0].split('?')[0].replace(/\/+$/, '');
    addCandidate(candidates, noQuery);
    addCandidate(candidates, withoutHtmlExtension(noQuery));

    var pathname = noQuery;
    try {
      pathname = new URL(raw, location.origin).pathname.replace(/\/+$/, '');
    } catch (error2) { /* ignore */ }
    addCandidate(candidates, pathname);
    addCandidate(candidates, withoutHtmlExtension(pathname));

    var parts = pathname.split('/').filter(Boolean);
    if (parts.length) {
      var last = parts[parts.length - 1];
      addCandidate(candidates, last);
      addCandidate(candidates, withoutHtmlExtension(last));
      try { addCandidate(candidates, decodeURIComponent(last)); } catch (error3) { /* ignore */ }
    }
    return candidates;
  }

  function looseIdentifier(value) {
    return text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function resolveIdentifier(value, identifiers) {
    if (!value) return null;
    var candidates = identifierCandidates(value);
    var byLower = {};
    var byLoose = {};
    identifiers.forEach(function (identifier) {
      byLower[String(identifier).toLowerCase()] = identifier;
      byLoose[looseIdentifier(identifier)] = identifier;
    });
    for (var index = 0; index < candidates.length; index++) {
      if (identifiers.indexOf(candidates[index]) !== -1) return candidates[index];
      var lowerMatch = byLower[String(candidates[index]).toLowerCase()];
      if (lowerMatch) return lowerMatch;
      var looseMatch = byLoose[looseIdentifier(candidates[index])];
      if (looseMatch) return looseMatch;
    }
    return null;
  }

  function parseJsonScript(root, selector) {
    var script = root.querySelector(selector);
    var raw = script ? script.textContent : '';
    if (!raw || !raw.trim()) return {};
    return JSON.parse(raw);
  }

  function headerKey(value) {
    return text(value).toLowerCase().replace(/[\s_-]+/g, '');
  }

  function tableHeaders(table) {
    var headers = {};
    table.querySelectorAll('thead th').forEach(function (cell, index) {
      headers[headerKey(cell.textContent)] = index;
    });
    return headers;
  }

  function cellAt(cells, headers, names) {
    for (var index = 0; index < names.length; index++) {
      var column = headers[headerKey(names[index])];
      if (column !== undefined && cells[column]) return cells[column];
    }
    return null;
  }

  function codeValues(cell) {
    if (!cell) return [];
    return unique(Array.from(cell.querySelectorAll('code')).map(function (code) {
      return text(code.textContent);
    }));
  }

  function listCellValues(cell) {
    var codes = codeValues(cell);
    return codes.length ? codes : splitList(cell ? cell.textContent : '');
  }

  function parseCompleted(cell) {
    return COMPLETED_VALUES.has(text(cell ? cell.textContent : '').toLowerCase());
  }

  function parseLinks(cell) {
    if (!cell) return [];
    return Array.from(cell.querySelectorAll('a[href]')).map(function (anchor) {
      return { label: text(anchor.textContent) || anchor.href, url: anchor.getAttribute('href') };
    });
  }

  function parseV2Course(cells, headers) {
    var courseCell = cellAt(cells, headers, ['course']);
    var identifiers = codeValues(courseCell);
    if (!courseCell || !identifiers.length) return null;
    var nameNode = courseCell.querySelector('strong, b');
    var notesCell = cellAt(cells, headers, ['notes', 'description']);
    return {
      id: identifiers[0],
      alias: identifiers.slice(1),
      name: text(nameNode ? nameNode.textContent : identifiers[0]),
      cat: text((cellAt(cells, headers, ['category', 'cat']) || {}).textContent) || 'other',
      majors: listCellValues(cellAt(cells, headers, ['programs', 'majors', 'major'])),
      prereqs: listCellValues(cellAt(cells, headers, ['prerequisites', 'prereqs'])),
      tags: listCellValues(cellAt(cells, headers, ['tags'])),
      completed: parseCompleted(cellAt(cells, headers, ['completed', 'done'])),
      desc: text(notesCell ? notesCell.textContent : ''),
      links: parseLinks(notesCell),
      alts: identifiers.slice(1).join(', ')
    };
  }

  function parsePlainCourses(root, issues) {
    var table = root.querySelector('table');
    if (!table) {
      issues.errors.push('The syllabus YAML block must be followed by a course table.');
      return { courses: [], table: null, version: 3 };
    }
    var headers = tableHeaders(table);
    ['id', 'name', 'programs'].forEach(function (header) {
      if (headers[header] === undefined) issues.errors.push('Course table is missing the "' + header + '" column.');
    });
    var courses = [];
    var seen = new Set();
    table.querySelectorAll('tbody tr').forEach(function (row) {
      var cells = Array.from(row.querySelectorAll('td'));
      function value(names) {
        var cell = cellAt(cells, headers, names);
        return text(cell ? cell.textContent : '');
      }
      var id = value(['id']);
      var name = value(['name']);
      if (!id || !name) {
        issues.errors.push('Every course row needs a plain id and name.');
        return;
      }
      if (Object.prototype.hasOwnProperty.call(Object.prototype, id)) {
        issues.errors.push('Reserved course identifier: ' + id + '.');
        return;
      }
      if (seen.has(id)) {
        issues.errors.push('Duplicate course identifier: ' + id + '.');
        return;
      }
      seen.add(id);
      var completion = value(['completed']).toLowerCase();
      if (completion && !COMPLETED_VALUES.has(completion) && ['no', 'false', '0'].indexOf(completion) === -1) {
        issues.errors.push(id + ': completed must be yes, no, or empty.');
      }
      var notes = cellAt(cells, headers, ['notes']);
      courses.push({
        id: id,
        name: name,
        alias: splitList(value(['aliases', 'alias'])),
        cat: value(['category', 'cat']) || 'other',
        majors: splitList(value(['programs'])),
        prereqs: splitList(value(['prerequisites', 'prereqs'])),
        tags: splitList(value(['tags'])),
        completed: COMPLETED_VALUES.has(completion),
        desc: text(notes ? notes.textContent : ''),
        links: parseLinks(notes),
        alts: ''
      });
    });
    return { courses: courses, table: table, version: 3 };
  }

  function parseLegacyCourse(cells, linkData) {
    if (cells.length < 8) return null;
    var id = text(cells[0].textContent);
    if (!id) return null;
    var links = linkData[id] || {};
    return {
      id: id,
      alias: splitList(cells[1].textContent),
      name: text(cells[2].textContent),
      cat: text(cells[3].textContent) || 'other',
      majors: splitList(cells[4].textContent),
      prereqs: splitList(cells[5].textContent),
      req: splitList(cells[6].textContent),
      tags: [],
      completed: false,
      desc: text(cells[7].textContent),
      links: Array.isArray(links.links) ? links.links : [],
      alts: text(links.alts)
    };
  }

  function findCourseTable(root) {
    var v2 = root.querySelector('.sd-courses table');
    if (v2) return { table: v2, version: 2 };
    var legacy = root.querySelector('table.sd-src') || root.querySelector('table');
    return legacy ? { table: legacy, version: 1 } : null;
  }

  function parseCourses(root, linkData, issues) {
    var found = findCourseTable(root);
    if (!found) {
      issues.errors.push('No curriculum course table was found.');
      return { courses: [], version: 0, table: null };
    }
    var headers = tableHeaders(found.table);
    var rows = found.table.querySelectorAll('tbody tr');
    if (!rows.length) rows = found.table.querySelectorAll('tr');
    var courses = [];
    var seen = new Set();
    rows.forEach(function (row) {
      var cells = Array.from(row.querySelectorAll('td'));
      if (!cells.length) return;
      var course = found.version === 2
        ? parseV2Course(cells, headers)
        : parseLegacyCourse(cells, linkData);
      if (!course) {
        issues.errors.push('A course row is missing its course identifier or required columns.');
        return;
      }
      if (seen.has(course.id)) {
        issues.errors.push('Duplicate course identifier: ' + course.id + '.');
        return;
      }
      seen.add(course.id);
      courses.push(course);
    });
    return { courses: courses, version: found.version, table: found.table };
  }

  function directListItems(element) {
    for (var index = 0; index < element.children.length; index++) {
      var child = element.children[index];
      if (child.tagName === 'UL' || child.tagName === 'OL') {
        return Array.from(child.children).filter(function (item) {
          return item.tagName === 'LI';
        });
      }
    }
    return [];
  }

  function ruleLabel(element, fallback) {
    var heading = element.querySelector('h1, h2, h3, h4, h5, h6');
    return text(heading ? heading.textContent : fallback);
  }

  function blockBodyHtml(element) {
    var clone = element.cloneNode(true);
    var heading = clone.querySelector('h1, h2, h3, h4, h5, h6');
    if (heading) heading.remove();
    return clone.innerHTML.trim();
  }

  function parseRule(element, programId, index) {
    var kind = text(element.dataset.sdKind || 'manual').toLowerCase();
    var rawCount = text(element.dataset.sdCount);
    var rawPerGroup = text(element.dataset.sdPerGroup);
    var count = parseInt(rawCount, 10);
    var perGroup = parseInt(rawPerGroup, 10);
    var items = directListItems(element);
    var candidates = unique(items.reduce(function (all, item) {
      return all.concat(codeValues(item));
    }, []));
    var groups = [];
    if (kind === 'distinct-groups' || kind === 'any-of') {
      groups = directListItems(element).map(function (item, groupIndex) {
        var values = codeValues(item);
        return {
          id: text(item.dataset.sdGroup || values[0] || ('group-' + (groupIndex + 1))),
          label: text((item.querySelector('strong, b') || {}).textContent) || ('Group ' + (groupIndex + 1)),
          tokens: values
        };
      }).filter(function (group) { return group.tokens.length > 0; });
      candidates = [];
    }
    return {
      id: text(element.dataset.sdRule || (programId + '-rule-' + (index + 1))),
      programId: programId,
      kind: kind,
      label: ruleLabel(element, 'Requirement ' + (index + 1)),
      count: Number.isFinite(count) && count > 0 ? count : (kind === 'all' ? candidates.length : 1),
      perGroup: Number.isFinite(perGroup) && perGroup > 0 ? perGroup : 1,
      candidates: candidates,
      tags: splitList(element.dataset.sdTags || element.dataset.sdTag || ''),
      groups: groups,
      detail: text(element.textContent),
      detailHtml: blockBodyHtml(element),
      invalidCount: !!rawCount && (!Number.isFinite(count) || count < 1),
      invalidPerGroup: !!rawPerGroup && (!Number.isFinite(perGroup) || perGroup < 1)
    };
  }

  function programSummaryHtml(element) {
    var clone = element.cloneNode(true);
    clone.querySelectorAll('.sd-rule').forEach(function (rule) { rule.remove(); });
    var heading = clone.querySelector('h1, h2, h3, h4, h5, h6');
    if (heading) heading.remove();
    return clone.innerHTML.trim();
  }

  function legacyProgramSummaryHtml(element) {
    if (!element) return '';
    var clone = element.cloneNode(true);
    var heading = clone.querySelector(':scope > b:first-child, :scope > strong:first-child');
    if (heading) heading.remove();
    return clone.innerHTML.trim();
  }

  function parsePrograms(root, courses, legacyNames, issues) {
    var programs = [];
    var declaredProgramIds = unique(courses.reduce(function (all, course) {
      return all.concat(course.majors);
    }, []));
    var v2Programs = root.querySelectorAll('.sd-program[data-sd-program]');
    v2Programs.forEach(function (element) {
      var rawId = text(element.dataset.sdProgram);
      var id = resolveIdentifier(rawId, declaredProgramIds) || rawId;
      if (!id) return;
      if (programs.some(function (program) { return program.id === id; })) {
        issues.errors.push('Duplicate program identifier: ' + id + '.');
        return;
      }
      var heading = element.querySelector('h1, h2, h3, h4, h5, h6');
      var rules = Array.from(element.querySelectorAll('.sd-rule')).map(function (rule, index) {
        return parseRule(rule, id, index);
      });
      programs.push({
        id: id,
        name: text(heading ? heading.textContent : id),
        summaryHtml: programSummaryHtml(element),
        rules: rules,
        source: element
      });
    });

    if (programs.length) return programs;

    var majorIds = unique(
      Object.keys(legacyNames).concat(
        courses.reduce(function (all, course) { return all.concat(course.majors); }, [])
      )
    );
    majorIds.forEach(function (id) {
      var desc = Array.from(root.querySelectorAll('.sd-major-desc')).find(function (element) {
        return resolveIdentifier(element.dataset.sdMajor, majorIds) === id;
      });
      var byCategory = {};
      courses.forEach(function (course) {
        if ((course.req || []).indexOf(id) === -1) return;
        (byCategory[course.cat] = byCategory[course.cat] || []).push(course.id);
      });
      var rules = Object.keys(byCategory).map(function (category, index) {
        return {
          id: id + '-legacy-' + index,
          programId: id,
          kind: 'all',
          label: titleCase(category),
          count: byCategory[category].length,
          perGroup: 1,
          candidates: byCategory[category],
          tags: [],
          groups: [],
          detail: '',
          detailHtml: ''
        };
      });
      programs.push({
        id: id,
        name: legacyNames[id] || id,
        summaryHtml: legacyProgramSummaryHtml(desc),
        rules: rules,
        source: desc
      });
    });
    return programs;
  }

  function validateModel(model, issues) {
    var byId = model.courseById;
    model.courses.forEach(function (course) {
      course.prereqs.forEach(function (id) {
        if (!byId[id]) addIssue(issues.warnings, course.id + ' references an unmodeled prerequisite: ' + id + '.');
      });
    });

    var visiting = new Set();
    var visited = new Set();
    function visit(id, trail) {
      if (visiting.has(id)) {
        addIssue(issues.errors, 'Prerequisite cycle: ' + trail.concat(id).join(' -> ') + '.');
        return;
      }
      if (visited.has(id) || !byId[id]) return;
      visiting.add(id);
      byId[id].prereqs.forEach(function (parent) { visit(parent, trail.concat(id)); });
      visiting.delete(id);
      visited.add(id);
    }
    model.courses.forEach(function (course) { visit(course.id, []); });

    var validKinds = new Set(['all', 'choose', 'tag', 'distinct-groups', 'any-of', 'manual']);
    model.programs.forEach(function (program) {
      var ruleIds = new Set();
      var programRuleIds = new Set(programRuleCourseIds(model, program));
      var programCourses = model.courses.filter(function (course) {
        return course.majors.indexOf(program.id) !== -1
          || programRuleIds.has(course.id);
      });
      if (!programCourses.length) {
        addIssue(issues.warnings, program.id + ' has no courses in the catalog.');
      }
      program.rules.forEach(function (rule) {
        if (ruleIds.has(rule.id)) {
          addIssue(issues.errors, program.id + ' has a duplicate rule identifier: ' + rule.id + '.');
        }
        ruleIds.add(rule.id);
        if (!validKinds.has(rule.kind)) {
          addIssue(issues.errors, program.id + ' / ' + rule.label + ' uses an unknown rule kind: ' + rule.kind + '.');
        }
        if (rule.invalidCount || rule.invalidPerGroup) {
          addIssue(issues.errors, program.id + ' / ' + rule.label + ' has an invalid positive count.');
        }
        if (
          rule.kind !== 'manual' &&
          rule.kind !== 'tag' &&
          rule.kind !== 'distinct-groups' &&
          rule.kind !== 'any-of' &&
          !rule.candidates.length
        ) {
          addIssue(issues.errors, program.id + ' / ' + rule.label + ' has no course candidates.');
        }
        if ((rule.kind === 'distinct-groups' || rule.kind === 'any-of') && !rule.groups.length) {
          addIssue(issues.errors, program.id + ' / ' + rule.label + ' has no groups.');
        }
        if (rule.kind === 'tag' && !rule.tags.length) {
          addIssue(issues.errors, program.id + ' / ' + rule.label + ' has no tag.');
        }
        if (rule.kind === 'choose') {
          var modeledCandidates = unique(rule.candidates.reduce(function (all, token) {
            return all.concat(tokenCourses(model, token));
          }, []));
          if (modeledCandidates.length < rule.count) {
            addIssue(
              issues.warnings,
              program.id + ' / ' + rule.label + ' can satisfy only '
                + modeledCandidates.length + ' of ' + rule.count + ' from the modeled catalog.'
            );
          }
        }
      });
    });
  }

  function normalizeModelReferences(model, issues) {
    var aliases = Object.create(null);
    model.courses.forEach(function (course) {
      course.alias.forEach(function (alias) {
        if (model.courseById[alias] && model.courseById[alias].id !== course.id) {
          addIssue(issues.warnings, 'Alias ' + alias + ' conflicts with a canonical course identifier.');
        } else if (aliases[alias] && aliases[alias] !== course.id) {
          addIssue(issues.warnings, 'Alias ' + alias + ' belongs to more than one course.');
        } else {
          aliases[alias] = course.id;
        }
      });
    });
    function normalizeToken(token) {
      return token.indexOf('tag:') === 0 ? token : (aliases[token] || token);
    }
    model.courses.forEach(function (course) {
      course.prereqs = unique(course.prereqs.map(normalizeToken));
    });
    model.programs.forEach(function (program) {
      program.rules.forEach(function (rule) {
        rule.candidates = unique(rule.candidates.map(normalizeToken));
        var choices = new Set();
        rule.groups.forEach(function (group) {
          group.tokens = unique(group.tokens.map(normalizeToken));
          if (rule.fromSpec && rule.kind === 'any-of') {
            var signature = JSON.stringify(group.tokens.slice().sort());
            if (choices.has(signature)) {
              addIssue(issues.errors, program.id + ' / ' + rule.label + ' repeats an alternative through course aliases.');
            }
            choices.add(signature);
          }
        });
      });
    });
  }

  function readCodeSource(codeEl) {
    if (window.CodeBlocks && typeof window.CodeBlocks.readSource === 'function') {
      return window.CodeBlocks.readSource(codeEl);
    }
    return codeEl.textContent;
  }

  function parseModel(root) {
    var issues = { errors: [], warnings: [] };
    var catOverrides = {};
    var legacyNames = {};
    var linkData = {};
    var yamlSource = root.querySelector('pre.syllabus code, pre.syllabus');
    var config = null;
    var courseResult;
    var programs;
    if (yamlSource) {
      try {
        if (!window.SyllabusSpec) throw new Error('Syllabus specification parser is unavailable.');
        // Read the block's *original* source (see code-blocks.js), not its
        // current textContent: once highlight.js's line-number pass has
        // wrapped this element into one <span class="code-line"> per line
        // (see page.html's _hljsRun / shell-router.js's SPA remount, which
        // may run before this feature mounts), plain textContent has no
        // newlines left and every valid YAML document becomes one invalid
        // mapping line.
        config = window.SyllabusSpec.parseConfig(readCodeSource(yamlSource.querySelector('code') || yamlSource));
      } catch (error) {
        issues.errors.push('Invalid syllabus YAML: ' + error.message);
      }
      courseResult = parsePlainCourses(root, issues);
      programs = config ? config.programs.map(function (program) {
        return {
          id: program.id,
          name: program.name,
          summaryHtml: '',
          rules: program.rules.map(function (rule) {
            rule.fromSpec = true;
            rule.detailHtml = rule.note ? '<p>' + escapeHtml(rule.note) + '</p>' : '';
            return rule;
          })
        };
      }) : [];
    } else {
      try {
        catOverrides = parseJsonScript(root, 'script.sd-cats');
        legacyNames = parseJsonScript(root, 'script.sd-majors');
        linkData = parseJsonScript(root, 'script.sd-links');
      } catch (error2) {
        issues.errors.push('Failed to parse legacy curriculum JSON: ' + error2.message);
      }
      courseResult = parseCourses(root, linkData, issues);
      programs = parsePrograms(root, courseResult.courses, legacyNames, issues);
    }
    var courses = courseResult.courses;
    var courseById = Object.create(null);
    courses.forEach(function (course) { courseById[course.id] = course; });
    var programById = Object.create(null);
    programs.forEach(function (program) { programById[program.id] = program; });
    if (config) {
      courses.forEach(function (course) {
        course.majors.forEach(function (id) {
          if (!programById[id]) issues.errors.push(course.id + ' references an undeclared program: ' + id + '.');
        });
      });
    }
    var categories = Object.create(null);
    courses.forEach(function (course) {
      if (categories[course.cat]) return;
      var override = catOverrides[course.cat] || {};
      var hue = (Object.keys(categories).length * 137.508) % 360;
      categories[course.cat] = {
        id: course.cat,
        label: override.label || titleCase(course.cat),
        color: override.color || ('hsl(' + Math.round(hue) + ', 65%, 45%)')
      };
    });

    var model = {
      version: courseResult.version,
      courses: courses,
      courseById: courseById,
      programs: programs,
      programById: programById,
      categories: categories,
      table: courseResult.table,
      key: config ? config.key : root.dataset.key,
      defaultProgram: config ? config.defaultProgram : root.dataset.defaultMajor,
      issues: issues
    };
    normalizeModelReferences(model, issues);
    validateModel(model, issues);
    return model;
  }

  function tokenCourses(model, token) {
    if (token.indexOf('tag:') === 0) {
      return model.courses.filter(function (course) {
        return course.tags.indexOf(token.substring(4)) !== -1;
      }).map(function (course) { return course.id; });
    }
    return model.courseById[token] ? [token] : [];
  }

  function programRuleCourseIds(model, program) {
    if (!program) return [];
    var tokens = [];
    program.rules.forEach(function (rule) {
      tokens = tokens.concat(rule.candidates);
      tokens = tokens.concat(rule.tags.map(function (tag) {
        return tag.indexOf('tag:') === 0 ? tag : 'tag:' + tag;
      }));
      rule.groups.forEach(function (group) { tokens = tokens.concat(group.tokens); });
    });
    return unique(tokens.reduce(function (all, token) {
      return all.concat(tokenCourses(model, token));
    }, []));
  }

  function allocateGroups(groups, selectedIndexes, perGroup) {
    var slots = [];
    selectedIndexes.forEach(function (groupIndex) {
      for (var index = 0; index < perGroup; index++) slots.push(groupIndex);
    });
    var courseToSlot = {};
    function assign(slotIndex, visitedCourses) {
      var groupIndex = slots[slotIndex];
      var candidates = groups[groupIndex].matched;
      for (var index = 0; index < candidates.length; index++) {
        var courseId = candidates[index];
        if (visitedCourses.has(courseId)) continue;
        visitedCourses.add(courseId);
        var previousSlot = courseToSlot[courseId];
        if (previousSlot === undefined || assign(previousSlot, visitedCourses)) {
          courseToSlot[courseId] = slotIndex;
          return true;
        }
      }
      return false;
    }
    for (var slotIndex = 0; slotIndex < slots.length; slotIndex++) {
      if (!assign(slotIndex, new Set())) return null;
    }
    return { selected: new Set(selectedIndexes), courseToSlot: courseToSlot };
  }

  function findDistinctGroupAllocation(groups, requiredGroups, perGroup) {
    var eligible = groups.map(function (group, index) {
      return group.matched.length >= perGroup ? index : -1;
    }).filter(function (index) { return index >= 0; });
    var attempts = 0;
    var exhausted = false;

    function findForSize(size) {
      var found = null;
      function visit(start, chosen) {
        if (found || exhausted) return;
        if (chosen.length === size) {
          attempts++;
          if (attempts > MAX_GROUP_ALLOCATION_ATTEMPTS) {
            exhausted = true;
            return;
          }
          found = allocateGroups(groups, chosen, perGroup);
          return;
        }
        for (var index = start; index <= eligible.length - (size - chosen.length); index++) {
          chosen.push(eligible[index]);
          visit(index + 1, chosen);
          chosen.pop();
          if (found) return;
        }
      }
      visit(0, []);
      return found;
    }

    for (var size = Math.min(requiredGroups, eligible.length); size > 0; size--) {
      var allocation = findForSize(size);
      if (allocation) return Object.assign(allocation, { exhausted: false });
      if (exhausted) break;
    }
    return { selected: new Set(), courseToSlot: {}, exhausted: exhausted };
  }

  function evaluateRule(model, rule, completed) {
    if (rule.kind === 'manual') {
      return {
        rule: rule,
        trackable: false,
        achieved: 0,
        target: rule.count,
        satisfied: false,
        matched: [],
        missing: rule.candidates.filter(function (token) {
          return tokenCourses(model, token).length === 0;
        }),
        groups: []
      };
    }

    if (rule.kind === 'distinct-groups' || rule.kind === 'any-of') {
      var groupResults = rule.groups.map(function (group) {
        var ids = unique(group.tokens.reduce(function (all, token) {
          return all.concat(tokenCourses(model, token));
        }, []));
        var matched = ids.filter(function (id) { return completed.has(id); });
        var missingTokens = group.tokens.filter(function (token) {
          return tokenCourses(model, token).length === 0;
        });
        var groupTarget = rule.kind === 'any-of' ? ids.length + missingTokens.length : rule.perGroup;
        return {
          id: group.id,
          label: group.label,
          ids: ids,
          matched: matched,
          achieved: Math.min(matched.length, groupTarget),
          target: groupTarget,
          satisfied: matched.length >= groupTarget,
          missing: missingTokens
        };
      });
      var allocation = rule.kind === 'distinct-groups'
        ? findDistinctGroupAllocation(groupResults, rule.count, rule.perGroup)
        : { selected: new Set(groupResults.map(function (group, index) {
          return group.satisfied ? index : -1;
        }).filter(function (index) { return index >= 0; })), exhausted: false };
      groupResults.forEach(function (group, index) {
        group.satisfied = allocation.selected.has(index);
        group.achieved = group.satisfied
          ? group.target
          : Math.min(group.achieved, Math.max(0, group.target - 1));
      });
      var satisfiedGroups = allocation.selected.size;
      var requiredGroups = rule.count;
      return {
        rule: rule,
        trackable: !allocation.exhausted,
        achieved: Math.min(satisfiedGroups, requiredGroups),
        target: requiredGroups,
        satisfied: !allocation.exhausted && satisfiedGroups >= requiredGroups,
        matched: unique(groupResults.reduce(function (all, group) { return all.concat(group.matched); }, [])),
        missing: unique(groupResults.reduce(function (all, group) { return all.concat(group.missing); }, [])),
        groups: groupResults,
        reason: allocation.exhausted
          ? 'This overlapping group rule is too complex to evaluate safely in the browser.'
          : ''
      };
    }

    var tokens = rule.kind === 'tag'
      ? rule.tags.map(function (tag) { return tag.indexOf('tag:') === 0 ? tag : 'tag:' + tag; })
      : rule.candidates;
    var candidateIds = unique(tokens.reduce(function (all, token) {
      return all.concat(tokenCourses(model, token));
    }, []));
    var missing = tokens.filter(function (token) { return tokenCourses(model, token).length === 0; });
    var matched = candidateIds.filter(function (id) { return completed.has(id); });
    var target = rule.kind === 'all' ? candidateIds.length + missing.length : rule.count;
    return {
      rule: rule,
      trackable: true,
      achieved: Math.min(matched.length, target),
      target: target,
      satisfied: matched.length >= target,
      matched: matched,
      missing: missing,
      groups: []
    };
  }

  function readCompletionState(storageKey, baseline, issues) {
    var raw;
    try {
      raw = localStorage.getItem(storageKey);
    } catch (error) {
      issues.warnings.push('Saved progress could not be read; showing initial progress.');
      return { completed: new Set(baseline), source: 'markdown' };
    }
    if (!raw) return { completed: new Set(baseline), source: 'markdown' };
    try {
      var parsed = JSON.parse(raw);
      var values = Array.isArray(parsed) ? parsed : parsed.completed;
      if (!Array.isArray(values)) throw new Error('Expected an array of course identifiers.');
      return {
        completed: new Set(values.filter(function (id) { return typeof id === 'string'; })),
        source: Array.isArray(parsed) ? 'legacy-local' : 'local'
      };
    } catch (error2) {
      issues.warnings.push('Stored progress was invalid; showing initial progress.');
      return { completed: new Set(baseline), source: 'markdown' };
    }
  }

  function wrapYamlSources(scope) {
    var blocks = [];
    if (scope.matches && scope.matches('pre.syllabus')) blocks.push(scope);
    scope.querySelectorAll('pre.syllabus').forEach(function (pre) { blocks.push(pre); });
    return blocks.filter(function (pre) { return !pre.closest('.syllabus-dag'); }).map(function (pre) {
      var source = pre.closest('div.sourceCode') || pre;
      var next = source.nextElementSibling;
      var table = next && (next.matches('table') ? next : next.querySelector(':scope > table'));
      var root = document.createElement('div');
      root.className = 'syllabus-dag';
      source.replaceWith(root);
      root.appendChild(source);
      if (table) root.appendChild(next);
      return root;
    });
  }

  function initSyllabusEnhance(root) {
    trackedDags = trackedDags.filter(function (element) {
      if (element.isConnected) return true;
      var dispose = dagDisposers.get(element);
      if (dispose) dispose();
      dagDisposers.delete(element);
      return false;
    });

    var scope = root || document;
    var dags = wrapYamlSources(scope);
    var bindings = [];
    if (scope.nodeType === 1 && scope.matches && scope.matches('.syllabus-dag')) dags.push(scope);
    scope.querySelectorAll('.syllabus-dag').forEach(function (element) { dags.push(element); });
    unique(dags).forEach(function (element) {
      if (dagDisposers.has(element)) {
        bindings.push({ element: element, dispose: dagDisposers.get(element) });
        return;
      }
      try {
        var dispose = initDag(element);
        if (typeof dispose === 'function') {
          dagDisposers.set(element, dispose);
          trackedDags.push(element);
          bindings.push({ element: element, dispose: dispose });
        }
      } catch (error) {
        var disposeFailed = dagDisposers.get(element);
        if (disposeFailed) disposeFailed();
        dagDisposers.delete(element);
        element.classList.remove('sd-enhanced');
        delete element.dataset.seEnhanced;
        element.querySelectorAll(':scope > .sd-app, :scope > .sd-fatal').forEach(function (child) {
          child.remove();
        });
        renderFatalIssues(element, { errors: ['Unexpected curriculum error: ' + error.message] });
        if (window._log) _log.error('syllabus', 'Unexpected curriculum initialization error', String(error));
        else console.error('[reading.syllabus] Unexpected curriculum initialization error', error);
      }
    });

    return function disposeSyllabus() {
      bindings.forEach(function (binding) {
        if (dagDisposers.get(binding.element) !== binding.dispose) return;
        binding.dispose();
        dagDisposers.delete(binding.element);
        trackedDags = trackedDags.filter(function (element) { return element !== binding.element; });
      });
    };
  }

  window.SyllabusEnhance = Object.freeze({ readModel: parseModel, evaluateRule: evaluateRule });
  window.initSyllabusEnhance = initSyllabusEnhance;
  if (window.RprintPageModules) {
    window.RprintPageModules.register({ id: 'reading.syllabus', mount: initSyllabusEnhance });
  } else {
    initSyllabusEnhance(document);
  }

  function initDag(root) {
    if (root.dataset.seEnhanced) return undefined;
    var model = parseModel(root);
    if (!model.table || !model.courses.length || !model.programs.length
      || (model.version === 3 && model.issues.errors.length)) {
      if (window._log) {
        _log.error('syllabus', 'Failed to initialize curriculum DAG', model.issues.errors.join(' '));
      }
      renderFatalIssues(root, model.issues);
      return undefined;
    }

    root.dataset.seEnhanced = '1';
    root.classList.add('sd-enhanced');
    var disposed = false;
    var lifetime = new AbortController();
    function listen(element, type, handler) {
      element.addEventListener(type, handler, { signal: lifetime.signal });
    }
    dagDisposers.set(root, disposeDag);
    var dagIndex = Array.from(document.querySelectorAll('.syllabus-dag')).indexOf(root);
    var storageKey = model.key || (
      dagIndex <= 0
        ? 'syllabus-dag-taken'
        : 'syllabus-dag-taken:' + location.pathname + ':' + dagIndex
    );
    var baseline = new Set(model.courses.filter(function (course) {
      return course.completed;
    }).map(function (course) { return course.id; }));
    var completionState = readCompletionState(storageKey, baseline, model.issues);
    var completed = new Set(Array.from(completionState.completed).filter(function (id) {
      return !!model.courseById[id];
    }));
    var currentMode = 'explore';
    var selectedId = null;
    var focusSelected = false;
    var lastGraphWidth = 0;

    var authorSources = markAuthorSource(root, model);
    if (window._log) {
      model.issues.errors.forEach(function (message) {
        _log.error('syllabus', 'Invalid curriculum data', message);
      });
      if (typeof _log.warn === 'function') {
        model.issues.warnings.forEach(function (message) {
          _log.warn('syllabus', 'Incomplete curriculum data', message);
        });
      }
    }

    var app = document.createElement('section');
    do { app.id = 'sd-app-' + (++nextAppId); } while (document.getElementById(app.id));
    app.className = 'sd-app';
    app.setAttribute('aria-label', 'Curriculum explorer');
    app.dataset.mode = currentMode;

    var toolbar = document.createElement('div');
    toolbar.className = 'sd-toolbar';
    var select = document.createElement('select');
    select.className = 'sd-program-select';
    select.setAttribute('aria-label', 'Degree program');
    var allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = 'All courses';
    select.appendChild(allOption);
    model.programs.forEach(function (program) {
      var option = document.createElement('option');
      option.value = program.id;
      option.textContent = program.name;
      select.appendChild(option);
    });
    var defaultProgram = resolveIdentifier(model.defaultProgram, model.programs.map(function (program) {
      return program.id;
    }));
    select.value = defaultProgram || model.programs[0].id;
    toolbar.appendChild(select);

    var status = document.createElement('span');
    status.className = 'sd-status';
    status.setAttribute('aria-live', 'polite');
    toolbar.appendChild(status);

    var toolbarActions = document.createElement('div');
    toolbarActions.className = 'sd-toolbar-actions';
    toolbar.appendChild(toolbarActions);

    var resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'sd-reset';
    resetButton.setAttribute('aria-label', 'Reset progress');
    resetButton.title = 'Reset progress';
    resetButton.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2.7 6.4"/><path d="M3 4v7h7"/></svg>';
    toolbarActions.appendChild(resetButton);

    var searchWrap = document.createElement('div');
    searchWrap.className = 'sd-search-wrap';
    var searchToggle = document.createElement('button');
    searchToggle.type = 'button';
    searchToggle.className = 'sd-search-toggle';
    searchToggle.setAttribute('aria-label', 'Find course');
    searchToggle.title = 'Find course';
    searchToggle.setAttribute('aria-expanded', 'false');
    var searchIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    searchToggle.innerHTML = searchIcon;
    searchWrap.appendChild(searchToggle);
    var searchInputWrap = document.createElement('div');
    searchInputWrap.className = 'sd-search-input-wrap';
    searchInputWrap.id = app.id + '-search';
    searchInputWrap.hidden = true;
    searchToggle.setAttribute('aria-controls', searchInputWrap.id);
    searchInputWrap.innerHTML = searchIcon.replace('<svg ', '<svg class="sd-search-icon" ');
    var search = document.createElement('input');
    search.type = 'search';
    search.className = 'sd-search';
    search.placeholder = 'Find course';
    search.setAttribute('aria-label', 'Find course by code, name or alias');
    searchInputWrap.appendChild(search);
    var searchClose = document.createElement('button');
    searchClose.type = 'button';
    searchClose.className = 'sd-search-close';
    searchClose.setAttribute('aria-label', 'Close search');
    searchClose.title = 'Close search';
    searchClose.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
    searchInputWrap.appendChild(searchClose);
    searchWrap.appendChild(searchInputWrap);
    toolbarActions.appendChild(searchWrap);

    var tabs = document.createElement('div');
    tabs.className = 'sd-tabs';
    tabs.setAttribute('role', 'group');
    tabs.setAttribute('aria-label', 'Curriculum view');
    var exploreButton = makeTabButton('explore', 'Explore');
    var dashboardButton = makeTabButton('dashboard', 'Dashboard');
    tabs.appendChild(exploreButton);
    tabs.appendChild(dashboardButton);
    toolbarActions.appendChild(tabs);

    var issues = document.createElement('div');
    issues.className = 'sd-issues';
    var summaryRow = document.createElement('div');
    summaryRow.className = 'sd-summary-row';
    var legend = document.createElement('div');
    legend.className = 'sd-legend';
    summaryRow.appendChild(legend);

    var progress = document.createElement('span');
    progress.className = 'sd-progress';
    summaryRow.appendChild(progress);

    var requirementsButton = document.createElement('button');
    requirementsButton.type = 'button';
    requirementsButton.className = 'sd-requirements-toggle';
    requirementsButton.textContent = 'Requirements';
    requirementsButton.setAttribute('aria-expanded', 'false');

    var focusButton = document.createElement('button');
    focusButton.type = 'button';
    focusButton.className = 'sd-focus';
    focusButton.textContent = 'Focus path';
    focusButton.hidden = true;
    summaryRow.appendChild(focusButton);

    var detailsButton = document.createElement('button');
    detailsButton.type = 'button';
    detailsButton.className = 'sd-show-details';
    detailsButton.textContent = 'Details';
    detailsButton.hidden = true;
    summaryRow.appendChild(detailsButton);
    summaryRow.appendChild(requirementsButton);

    var requirementsPanel = document.createElement('section');
    requirementsPanel.className = 'sd-requirements';
    requirementsPanel.id = app.id + '-requirements';
    requirementsButton.setAttribute('aria-controls', requirementsPanel.id);
    requirementsPanel.setAttribute('aria-label', 'Degree requirements');
    requirementsPanel.hidden = true;
    var dashboardRules = document.createElement('div');
    dashboardRules.className = 'sd-dashboard-rules';
    requirementsPanel.appendChild(dashboardRules);

    var graph = document.createElement('div');
    graph.className = 'sd-graph';
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('role', 'group');
    svg.setAttribute('aria-label', 'Course prerequisite graph');
    graph.appendChild(svg);
    var details = document.createElement('aside');
    details.className = 'sd-details';
    details.setAttribute('aria-label', 'Course details');
    details.tabIndex = -1;
    details.hidden = true;
    graph.appendChild(details);

    app.appendChild(toolbar);
    app.appendChild(summaryRow);
    app.appendChild(issues);
    app.appendChild(requirementsPanel);
    app.appendChild(graph);
    root.insertBefore(app, root.firstChild);

    function makeTabButton(mode, label) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'sd-mode-btn' + (mode === currentMode ? ' sd-mode-active' : '');
      button.dataset.mode = mode;
      button.textContent = label;
      button.setAttribute('aria-pressed', mode === currentMode ? 'true' : 'false');
      listen(button, 'click', function () {
        currentMode = mode;
        app.dataset.mode = mode;
        exploreButton.classList.toggle('sd-mode-active', mode === 'explore');
        dashboardButton.classList.toggle('sd-mode-active', mode === 'dashboard');
        exploreButton.setAttribute('aria-pressed', mode === 'explore' ? 'true' : 'false');
        dashboardButton.setAttribute('aria-pressed', mode === 'dashboard' ? 'true' : 'false');
        details.hidden = true;
        requirementsPanel.hidden = true;
        requirementsButton.setAttribute('aria-expanded', 'false');
        updateProgress();
        applyGraphHighlight();
      });
      return button;
    }

    function saveCompletion() {
      try {
        localStorage.setItem(storageKey, JSON.stringify({
          version: 2,
          completed: Array.from(completed).sort()
        }));
        completionState.source = 'local';
        return true;
      } catch (error) {
        addIssue(model.issues.warnings, 'Browser progress could not be saved.');
        if (window._log) _log.error('syllabus', 'Failed to save curriculum progress', String(error));
        return false;
      }
    }

    function setCompleted(id, value) {
      if (value) completed.add(id);
      else completed.delete(id);
      var saved = saveCompletion();
      updateProgress();
      applyGraphHighlight();
      renderIssues();
      var unmet = model.courseById[id].prereqs.filter(function (parent) { return !completed.has(parent); });
      status.textContent = (value ? 'Marked ' : 'Unmarked ') + id + ' as completed.'
        + (value && unmet.length ? ' Prerequisites not completed: ' + unmet.join(', ') + '.' : '')
        + (saved ? '' : ' Could not save progress in this browser.');
    }

    function resetCompletion() {
      try {
        localStorage.removeItem(storageKey);
      } catch (error) {
        addIssue(model.issues.warnings, 'Browser progress could not be reset.');
        if (window._log) _log.error('syllabus', 'Failed to reset curriculum progress', String(error));
        renderIssues();
        status.textContent = 'Could not reset progress. Your progress has not changed.';
        return;
      }
      completed = new Set(baseline);
      completionState.source = 'markdown';
      updateProgress();
      applyGraphHighlight();
      status.textContent = 'Progress reset.';
    }

    function selectedProgram() {
      return select.value === 'all' ? null : model.programById[select.value];
    }

    function requiredCourseIds() {
      var program = selectedProgram();
      return new Set(program ? program.rules.filter(function (rule) {
        return rule.kind === 'all';
      }).reduce(function (ids, rule) {
        return ids.concat(rule.candidates.reduce(function (all, token) {
          return all.concat(tokenCourses(model, token));
        }, []));
      }, []) : []);
    }

    function baseVisibleCourses() {
      if (select.value === 'all') return model.courses.slice();
      var program = selectedProgram();
      var ruleIds = new Set(programRuleCourseIds(model, program));
      var included = new Set(model.courses.filter(function (course) {
        return course.majors.indexOf(select.value) !== -1 || ruleIds.has(course.id);
      }).map(function (course) { return course.id; }));
      var changed = true;
      while (changed) {
        changed = false;
        Array.from(included).forEach(function (id) {
          var course = model.courseById[id];
          if (!course) return;
          course.prereqs.forEach(function (prerequisite) {
            if (!model.courseById[prerequisite] || included.has(prerequisite)) return;
            included.add(prerequisite);
            changed = true;
          });
        });
      }
      return model.courses.filter(function (course) { return included.has(course.id); });
    }

    function graphRelations(courses) {
      var ids = new Set(courses.map(function (course) { return course.id; }));
      var parents = {};
      var children = {};
      courses.forEach(function (course) {
        parents[course.id] = course.prereqs.filter(function (id) { return ids.has(id); });
        children[course.id] = [];
      });
      courses.forEach(function (course) {
        parents[course.id].forEach(function (parent) { children[parent].push(course.id); });
      });
      return { parents: parents, children: children };
    }

    function relatedIds(startId, relations) {
      function distances(direction) {
        var result = new Map();
        var queue = [{ id: startId, depth: 0 }];
        for (var index = 0; index < queue.length; index++) {
          var entry = queue[index];
          (relations[direction][entry.id] || []).forEach(function (id) {
            if (id === startId || result.has(id)) return;
            result.set(id, entry.depth + 1);
            queue.push({ id: id, depth: entry.depth + 1 });
          });
        }
        return result;
      }
      return { parents: distances('parents'), children: distances('children') };
    }

    function visibleCourses() {
      var courses = baseVisibleCourses();
      if (!focusSelected || !selectedId) return courses;
      var relations = graphRelations(courses);
      var related = relatedIds(selectedId, relations);
      return courses.filter(function (course) {
        return course.id === selectedId || related.parents.has(course.id) || related.children.has(course.id);
      });
    }

    function computeLayers(courses) {
      var byId = {};
      courses.forEach(function (course) { byId[course.id] = course; });
      var cache = {};
      var pending = {};
      function depth(id) {
        if (cache[id] !== undefined) return cache[id];
        if (pending[id]) return 0;
        pending[id] = true;
        var max = -1;
        (byId[id] ? byId[id].prereqs : []).forEach(function (parent) {
          if (byId[parent]) max = Math.max(max, depth(parent));
        });
        delete pending[id];
        cache[id] = max + 1;
        return cache[id];
      }
      courses.forEach(function (course) { depth(course.id); });
      return cache;
    }

    function layout(courses, containerWidth, fontScale) {
      var padding = Math.min(16 * fontScale, containerWidth / 16);
      var availableWidth = Math.max(1, containerWidth - 2 * padding);
      var gapX = Math.round(16 * fontScale);
      var gapY = Math.round(36 * fontScale);
      var columns = Math.max(1, Math.min(6, Math.floor((availableWidth + gapX) / (152 * fontScale + gapX))));
      var nodeWidth = Math.min(240 * fontScale, (availableWidth - (columns - 1) * gapX) / columns);
      var nodeHeight = Math.round(72 * fontScale);
      if (!courses.length) {
        return {
          nodes: {},
          nodeWidth: nodeWidth,
          nodeHeight: nodeHeight,
          width: containerWidth,
          height: nodeHeight + 2 * padding
        };
      }
      var depthById = computeLayers(courses);
      var rawLayers = {};
      courses.forEach(function (course) {
        var depth = depthById[course.id] || 0;
        (rawLayers[depth] = rawLayers[depth] || []).push(course);
      });

      var layers = [];
      Object.keys(rawLayers).map(Number).sort(function (a, b) {
        return a - b;
      }).forEach(function (depth) {
        var layer = rawLayers[depth];
        for (var start = 0; start < layer.length; start += columns) {
          layers.push(layer.slice(start, start + columns));
        }
      });

      var positions = {};
      layers.forEach(function (layer, layerIndex) {
        layer.forEach(function (course, courseIndex) {
          positions[course.id] = courseIndex;
        });
      });
      for (var sweep = 0; sweep < 8; sweep++) {
        for (var layerIndex = 1; layerIndex < layers.length; layerIndex++) {
          layers[layerIndex].sort(function (left, right) {
            function score(course) {
              var parentPositions = course.prereqs.filter(function (id) {
                return positions[id] !== undefined;
              }).map(function (id) { return positions[id]; });
              return parentPositions.length
                ? parentPositions.reduce(function (sum, value) { return sum + value; }, 0) / parentPositions.length
                : positions[course.id];
            }
            return score(left) - score(right);
          });
          layers[layerIndex].forEach(function (course, index) { positions[course.id] = index; });
        }
      }

      var nodes = {};
      layers.forEach(function (layer, layerIndex) {
        var rowWidth = layer.length * nodeWidth + Math.max(0, layer.length - 1) * gapX;
        var offset = (containerWidth - rowWidth) / 2;
        layer.forEach(function (course, index) {
          nodes[course.id] = {
            x: offset + index * (nodeWidth + gapX),
            y: padding + layerIndex * (nodeHeight + gapY),
            row: layerIndex,
            course: course
          };
        });
      });

      return {
        nodes: nodes,
        nodeWidth: nodeWidth,
        nodeHeight: nodeHeight,
        width: containerWidth,
        height: layers.length * nodeHeight + Math.max(0, layers.length - 1) * gapY + padding * 2,
        padding: padding,
        gapY: gapY
      };
    }

    function nodeNameLines(name, maxChars) {
      var words = text(name).split(/\s+/);
      var lines = ['', ''];
      words.forEach(function (word) {
        var target = !lines[0] || (!lines[1] && (lines[0] + ' ' + word).trim().length <= maxChars) ? 0 : 1;
        lines[target] = (lines[target] + ' ' + word).trim();
      });
      if (lines[1].length > maxChars) lines[1] = lines[1].substring(0, maxChars - 1) + '\u2026';
      return lines.filter(Boolean);
    }

    function renderGraph() {
      var focusedNode = document.activeElement && document.activeElement.closest
        ? document.activeElement.closest('.sd-node')
        : null;
      var restoreFocusedId = focusedNode && svg.contains(focusedNode) ? focusedNode.dataset.id : null;
      var courses = visibleCourses();
      var containerWidth = graph.clientWidth || root.clientWidth || 800;
      lastGraphWidth = containerWidth;
      var baseFontSize = parseFloat(getComputedStyle(document.body).fontSize) || 16;
      var fontScale = Math.max(0.9, baseFontSize / 16);
      var layoutResult = layout(courses, containerWidth, fontScale);
      var svgWidth = layoutResult.width;
      var svgHeight = layoutResult.height;
      svg.setAttribute('viewBox', '0 0 ' + svgWidth + ' ' + svgHeight);
      svg.setAttribute('width', svgWidth);
      svg.setAttribute('height', svgHeight);
      svg.dataset.theme = document.documentElement.getAttribute('data-theme') || 'light';
      svg.style.fontFamily = 'inherit';
      svg.style.fontSize = baseFontSize + 'px';

      var markup = '';

      var isKindle = document.documentElement.getAttribute('data-theme') === 'kindle';
      var requiredIds = requiredCourseIds();
      Object.keys(layoutResult.nodes).forEach(function (id) {
        var node = layoutResult.nodes[id];
        var course = node.course;
        var category = model.categories[course.cat] || { color: '#777' };
        var color = isKindle ? '#000' : category.color;
        var aliases = course.alias.length ? ' (' + course.alias[0] + ')' : '';
        var nodeClass = 'sd-node' + (selectedProgram() && !requiredIds.has(id) ? ' is-option' : '');
        markup += '<g class="' + nodeClass + '" data-id="' + escapeAttr(course.id) + '" tabindex="0" '
          + 'style="--sd-category:' + escapeAttr(color) + '">';
        markup += '<title>' + escapeHtml(course.id + ' - ' + course.name
          + (course.alias.length ? ' (' + course.alias.join(', ') + ')' : '')) + '</title>';
        markup += '<rect class="sd-node-card" x="' + node.x + '" y="' + node.y + '" width="' + layoutResult.nodeWidth
          + '" height="' + layoutResult.nodeHeight + '" rx="6"></rect>';
        markup += '<rect class="sd-node-category" x="' + node.x + '" y="' + node.y + '" width="5" height="'
          + layoutResult.nodeHeight + '" rx="3" fill="' + escapeAttr(color) + '"></rect>';
        var code = course.id + aliases;
        markup += '<text class="sd-node-code" x="' + (node.x + layoutResult.nodeWidth / 2 + 3)
          + '" y="' + (node.y + Math.round(20 * fontScale)) + '" text-anchor="middle">' + escapeHtml(code) + '</text>';
        var lines = nodeNameLines(course.name, Math.max(8, Math.floor((layoutResult.nodeWidth - 24 * fontScale) / (7 * fontScale))));
        lines.forEach(function (line, lineIndex) {
          markup += '<text class="sd-node-name" x="' + (node.x + layoutResult.nodeWidth / 2 + 3)
            + '" y="' + (node.y + Math.round((40 + lineIndex * 16) * fontScale))
            + '" text-anchor="middle">' + escapeHtml(line) + '</text>';
        });
        markup += '<text class="sd-node-check" x="' + (node.x + layoutResult.nodeWidth - 12 * fontScale)
          + '" y="' + (node.y + 12 * fontScale) + '" aria-hidden="true">\u2713</text>';
        markup += '<text class="sd-node-depth" x="' + (node.x + layoutResult.nodeWidth - 5 * fontScale)
          + '" y="' + (node.y + 12 * fontScale) + '" text-anchor="end" aria-hidden="true"></text>';
        markup += '</g>';
      });
      if (!courses.length) {
        markup += '<text class="sd-empty-graph" x="' + (layoutResult.width / 2)
          + '" y="' + (layoutResult.nodeHeight / 2) + '" text-anchor="middle">'
          + 'No courses are modeled.</text>';
      }
      svg.innerHTML = markup;

      svg.querySelectorAll('.sd-node').forEach(function (node) {
        fitNodeText(node, layoutResult.nodeWidth - 24 * fontScale);
        function activateNode(event) {
          if (currentMode === 'dashboard') {
            setCompleted(node.dataset.id, !completed.has(node.dataset.id));
          } else {
            var showDetails = selectedId === node.dataset.id;
            selectedId = node.dataset.id;
            details.hidden = true;
            if (showDetails) renderDetails();
            updateProgress();
            applyGraphHighlight();
            if (showDetails && event.type === 'keydown') details.focus({ preventScroll: true });
          }
        }
        listen(node, 'click', activateNode);
        listen(node, 'keydown', function (event) {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          activateNode(event);
        });
      });
      if (restoreFocusedId) {
        var replacement = svg.querySelector('.sd-node[data-id="' + cssEscape(restoreFocusedId) + '"]');
        if (replacement) replacement.focus();
      }
      applyGraphHighlight();
      renderLegend();
      positionDetails();
    }

    function fitNodeText(node, maxWidth) {
      node.querySelectorAll('.sd-node-code, .sd-node-name').forEach(function (label) {
        if (typeof label.getComputedTextLength !== 'function' || label.getComputedTextLength() <= maxWidth) return;
        var original = label.textContent;
        var low = 0;
        var high = original.length;
        while (low < high) {
          var middle = Math.ceil((low + high) / 2);
          label.textContent = original.substring(0, middle) + '\u2026';
          if (label.getComputedTextLength() <= maxWidth) low = middle;
          else high = middle - 1;
        }
        label.textContent = original.substring(0, low) + '\u2026';
      });
    }

    function depthColor(direction, depth) {
      var theme = document.documentElement.getAttribute('data-theme');
      var bucket = Math.min(depth, 4);
      if (theme === 'kindle') return { stroke: '#000', fill: 'hsl(0, 0%, ' + (98 - bucket * 4) + '%)' };
      var hue = DEPTH_HUES[direction][bucket - 1];
      return {
        stroke: 'hsl(' + hue + ', 75%, ' + (theme === 'dark' ? 67 : 40) + '%)',
        fill: 'hsl(' + hue + ', 35%, ' + (theme === 'dark' ? 21 : 93) + '%)'
      };
    }

    function renderLegend() {
      legend.hidden = currentMode === 'dashboard';
      if (legend.hidden) {
        legend.replaceChildren();
        return;
      }
      legend.innerHTML = ['parents', 'children'].map(function (direction) {
          var entries = ['<span>' + (direction === 'parents' ? 'Prereqs' : 'Unlocks') + '</span>'];
          for (var depth = 1; depth <= 4; depth++) {
            var label = (direction === 'parents' ? '\u2191' : '\u2193') + depth + (depth === 4 ? '+' : '');
            entries.push('<span class="sd-legend-item" title="'
              + (direction === 'parents' ? 'Prerequisite' : 'Unlock') + ' depth ' + depth
              + (depth === 4 ? ' or greater' : '')
              + '"><span class="sd-legend-dot" style="background:' + depthColor(direction, depth).stroke
              + '"></span>' + label + '</span>');
          }
          return entries.join('');
        }).join('');
    }

    function applyGraphHighlight() {
      var nodes = Array.from(svg.querySelectorAll('.sd-node'));
      var query = text(search.value).toLowerCase();
      var visible = visibleCourses();
      var relations = graphRelations(visible);
      var highlightId = currentMode === 'explore' ? selectedId : null;
      var related = highlightId && relations.parents[highlightId]
        ? relatedIds(highlightId, relations)
        : { parents: new Map(), children: new Map() };

      nodes.forEach(function (node) {
        var id = node.dataset.id;
        var course = model.courseById[id];
        var matchesSearch = !query || courseMatchesQuery(course, query);
        var done = completed.has(id);
        var unmet = course.prereqs.filter(function (parent) { return !completed.has(parent); });
        var direction = related.parents.has(id) ? 'parents' : related.children.has(id) ? 'children' : null;
        var depth = direction ? related[direction].get(id) : null;
        var badge = node.querySelector('.sd-node-depth');
        if (direction) {
          var colors = depthColor(direction, depth);
          node.dataset.dependency = direction;
          node.dataset.depth = depth;
          node.style.setProperty('--sd-dependency-color', colors.stroke);
          node.style.setProperty('--sd-dependency-bg', colors.fill);
          badge.textContent = (direction === 'parents' ? '\u2191' : '\u2193') + depth;
        } else {
          delete node.dataset.dependency;
          if (highlightId === id) node.dataset.depth = '0';
          else delete node.dataset.depth;
          node.style.removeProperty('--sd-dependency-color');
          node.style.removeProperty('--sd-dependency-bg');
          badge.textContent = highlightId === id ? '0' : '';
        }
        node.classList.toggle('is-selected', id === highlightId);
        node.classList.toggle('is-prerequisite', related.parents.has(id));
        node.classList.toggle('is-dependent', related.children.has(id));
        node.classList.toggle('is-completed', done);
        node.classList.toggle('is-unavailable', currentMode === 'dashboard' && !done && unmet.length > 0);
        node.classList.toggle('is-search-match', !!query && matchesSearch);
        node.classList.toggle('is-dimmed', (!!highlightId
          && id !== highlightId
          && !related.parents.has(id)
          && !related.children.has(id)) || (!!query && !matchesSearch));
        node.setAttribute('role', currentMode === 'dashboard' ? 'checkbox' : 'button');
        node.setAttribute('aria-label', course.id + ', ' + course.name
          + (done ? ', completed' : ', not completed')
          + (direction ? ', ' + (direction === 'parents' ? 'prerequisite' : 'unlock') + ' depth ' + depth : '')
          + (selectedProgram() ? (node.classList.contains('is-option') ? ', option or supporting prerequisite' : ', required') : '')
          + (currentMode === 'dashboard' && unmet.length ? '. Prerequisites not completed: ' + unmet.join(', ') : ''));
        if (currentMode === 'dashboard') {
          node.setAttribute('aria-checked', done ? 'true' : 'false');
          node.removeAttribute('aria-pressed');
          node.removeAttribute('aria-expanded');
        } else {
          node.setAttribute('aria-pressed', id === selectedId ? 'true' : 'false');
          node.setAttribute('aria-expanded', id === selectedId && !details.hidden ? 'true' : 'false');
          node.removeAttribute('aria-checked');
        }
      });
    }

    function renderDetails() {
      if (!selectedId || !model.courseById[selectedId]) {
        details.hidden = true;
        details.replaceChildren();
        return;
      }
      var course = model.courseById[selectedId];
      var visible = baseVisibleCourses();
      var relations = graphRelations(visible);
      var category = model.categories[course.cat] || { label: course.cat };
      var html = '<button type="button" class="sd-details-close" aria-label="Close course details">Close</button>'
        + '<h3><code>' + escapeHtml(course.id) + '</code> ' + escapeHtml(course.name) + '</h3>';
      if (course.alias.length) html += '<p><strong>Aliases:</strong> ' + escapeHtml(course.alias.join(', ')) + '</p>';
      if (course.alts && course.alts !== course.alias.join(', ')) {
        html += '<p><strong>Also offered as:</strong> ' + escapeHtml(course.alts) + '</p>';
      }
      html += '<p><strong>Category:</strong> ' + escapeHtml(category.label) + '</p>';
      if (course.desc) html += '<p>' + escapeHtml(course.desc) + '</p>';
      if (course.links.length) {
        html += '<p class="sd-detail-links">' + course.links.map(function (link) {
          return '<a href="' + escapeAttr(link.url) + '" target="_blank" rel="noopener">'
            + escapeHtml(link.label) + '</a>';
        }).join(' ') + '</p>';
      }
      html += relationList('Prerequisites', course.prereqs);
      html += relationList('Unlocks', relations.children[course.id] || []);
      details.innerHTML = html;
      details.hidden = false;
      listen(details.querySelector('.sd-details-close'), 'click', function () {
        closeDetails(true);
      });
      positionDetails();
    }

    function positionDetails() {
      if (details.hidden || !selectedId) return;
      var anchor = svg.querySelector('.sd-node[data-id="' + cssEscape(selectedId) + '"]');
      if (!anchor) {
        details.hidden = true;
        return;
      }
      var graphRect = graph.getBoundingClientRect();
      var anchorRect = anchor.getBoundingClientRect();
      var width = details.getBoundingClientRect().width;
      details.style.left = Math.max(0, Math.min(
        anchorRect.left - graphRect.left,
        graphRect.width - width
      )) + 'px';
      details.style.top = (anchorRect.bottom - graphRect.top + 6) + 'px';
    }

    function closeDetails(restoreFocus) {
      var id = selectedId;
      details.hidden = true;
      updateProgress();
      applyGraphHighlight();
      if (restoreFocus && id) {
        var node = svg.querySelector('.sd-node[data-id="' + cssEscape(id) + '"]');
        if (node) node.focus({ preventScroll: true });
      }
    }

    function clearSelection() {
      selectedId = null;
      details.hidden = true;
      var wasFocused = focusSelected;
      focusSelected = false;
      updateProgress();
      if (wasFocused) renderGraph();
      else applyGraphHighlight();
    }

    function relationList(label, ids) {
      if (!ids.length) return '<p><strong>' + escapeHtml(label) + ':</strong> None in this view.</p>';
      return '<div><strong>' + escapeHtml(label) + ':</strong><ul>'
        + ids.map(function (id) {
          var course = model.courseById[id];
          return '<li><code>' + escapeHtml(id) + '</code> ' + escapeHtml(course ? course.name : '') + '</li>';
        }).join('') + '</ul></div>';
    }

    function renderIssues() {
      var allIssues = model.issues.errors.map(function (message) {
        return '<li class="sd-error">' + escapeHtml(message) + '</li>';
      }).concat(model.issues.warnings.map(function (message) {
        return '<li>' + escapeHtml(message) + '</li>';
      }));
      issues.innerHTML = allIssues.length
        ? '<details><summary>Data notes (' + allIssues.length + ')</summary><ul>' + allIssues.join('') + '</ul></details>'
        : '';
    }

    function renderRule(rule) {
      var result = evaluateRule(model, rule, completed);
      var stateClass = result.satisfied ? ' is-satisfied' : '';
      var progress = result.trackable ? result.achieved + '/' + result.target : 'Not automatically tracked';
      var html = '<details class="sd-rule-card' + stateClass + '" data-rule-id="'
        + escapeAttr(rule.id) + '"><summary><span>'
        + escapeHtml(rule.label) + '</span><strong>' + escapeHtml(progress) + '</strong></summary>';
      if (rule.detailHtml) html += '<div class="sd-rule-detail">' + rule.detailHtml + '</div>';
      if (rule.fromSpec && rule.candidates.length) {
        html += '<p>' + (rule.kind === 'all' ? 'Complete all: ' : 'Complete ' + rule.count + ' from: ')
          + rule.candidates.map(function (id) { return '<code>' + escapeHtml(id) + '</code>'; }).join(', ') + '</p>';
      }
      if (result.matched.length) {
        html += '<p><strong>Completed:</strong> ' + result.matched.map(function (id) {
          return '<code>' + escapeHtml(id) + '</code>';
        }).join(' ') + '</p>';
      }
      if (result.groups.length) {
        html += '<ul class="sd-rule-groups">' + result.groups.map(function (group) {
          return '<li class="' + (group.satisfied ? 'is-satisfied' : '') + '"><strong>'
            + escapeHtml(group.label) + ':</strong> ' + group.achieved + '/' + group.target + '</li>';
        }).join('') + '</ul>';
      }
      if (result.missing.length) {
        html += '<p class="sd-coverage-warning"><strong>Not modeled:</strong> '
          + result.missing.map(function (id) { return '<code>' + escapeHtml(id) + '</code>'; }).join(' ')
          + '</p>';
      }
      if (result.reason) {
        html += '<p class="sd-coverage-warning">' + escapeHtml(result.reason) + '</p>';
      }
      html += '</details>';
      return { html: html, result: result };
    }

    function courseMatchesQuery(course, query) {
      return course.id.toLowerCase().indexOf(query) !== -1
        || course.name.toLowerCase().indexOf(query) !== -1
        || course.alias.some(function (alias) { return alias.toLowerCase().indexOf(query) !== -1; });
    }

    function renderRequirements() {
      var program = selectedProgram();
      var rules = program ? program.rules : [];
      var renderedRules = rules.map(renderRule);
      var openRuleIds = new Set(Array.from(
        dashboardRules.querySelectorAll('.sd-rule-card[open][data-rule-id]')
      ).map(function (rule) { return rule.dataset.ruleId; }));
      dashboardRules.innerHTML = program
        ? (model.version === 1 ? program.summaryHtml : '')
          + renderedRules.map(function (item) { return item.html; }).join('')
        : '';
      dashboardRules.querySelectorAll('.sd-rule-card[data-rule-id]').forEach(function (rule) {
        rule.open = openRuleIds.has(rule.dataset.ruleId);
      });
    }

    function updateProgress() {
      var courses = baseVisibleCourses();
      var done = courses.filter(function (course) { return completed.has(course.id); }).length;
      progress.textContent = done + '/' + courses.length + ' completed';
      progress.hidden = currentMode !== 'dashboard';
      resetButton.hidden = currentMode !== 'dashboard';
      resetButton.disabled = completionState.source === 'markdown';
      focusButton.hidden = currentMode !== 'explore';
      detailsButton.hidden = currentMode !== 'explore';
      [focusButton, detailsButton].forEach(function (button) {
        button.disabled = !selectedId;
        button.classList.toggle('sd-selection-hidden', !selectedId);
      });
      focusButton.textContent = focusSelected ? 'Show full program' : 'Focus path';
      requirementsButton.hidden = !selectedProgram();
      if (!selectedProgram()) {
        requirementsPanel.hidden = true;
        requirementsButton.setAttribute('aria-expanded', 'false');
      }
      renderLegend();
      if (!requirementsPanel.hidden) renderRequirements();
      positionDetails();
    }

    listen(select, 'change', function () {
      selectedId = null;
      focusSelected = false;
      details.hidden = true;
      dashboardRules.replaceChildren();
      updateProgress();
      renderGraph();
      status.textContent = select.value === 'all'
        ? 'Showing all courses.'
        : 'Showing ' + model.programById[select.value].name + '.';
    });
    listen(search, 'input', function () {
      applyGraphHighlight();
    });
    function setSearchOpen(open, restoreFocus) {
      searchWrap.classList.toggle('is-open', open);
      searchToggle.hidden = open;
      searchToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      searchInputWrap.hidden = !open;
      if (open) search.focus();
      else {
        search.value = '';
        applyGraphHighlight();
        if (restoreFocus) searchToggle.focus({ preventScroll: true });
      }
    }
    listen(searchToggle, 'click', function () { setSearchOpen(true); });
    listen(searchClose, 'click', function () { setSearchOpen(false, true); });
    listen(searchWrap, 'keydown', function (event) {
      if (event.key !== 'Escape' || searchInputWrap.hidden) return;
      event.preventDefault();
      event.stopPropagation();
      setSearchOpen(false, true);
    });
    listen(search, 'keydown', function (event) {
      if (event.key !== 'Enter') return;
      var query = text(search.value).toLowerCase();
      if (!query) return;
      var match = baseVisibleCourses().find(function (course) {
        return courseMatchesQuery(course, query);
      });
      if (!match) return;
      if (focusSelected && !svg.querySelector('.sd-node[data-id="' + cssEscape(match.id) + '"]')) {
        focusSelected = false;
        renderGraph();
      }
      if (currentMode === 'explore') {
        selectedId = match.id;
        details.hidden = true;
      }
      updateProgress();
      applyGraphHighlight();
      var node = svg.querySelector('.sd-node[data-id="' + cssEscape(match.id) + '"]');
      if (node) node.focus();
    });
    listen(focusButton, 'click', function () {
      if (!selectedId) return;
      focusSelected = !focusSelected;
      updateProgress();
      renderGraph();
    });
    listen(resetButton, 'click', resetCompletion);
    listen(detailsButton, 'click', function () {
      renderDetails();
      applyGraphHighlight();
      if (!details.hidden) details.focus({ preventScroll: true });
    });
    listen(requirementsButton, 'click', function () {
      requirementsPanel.hidden = !requirementsPanel.hidden;
      requirementsButton.setAttribute('aria-expanded', requirementsPanel.hidden ? 'false' : 'true');
      if (!requirementsPanel.hidden) renderRequirements();
    });
    listen(app, 'keydown', function (event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (!searchInputWrap.hidden) {
        event.stopPropagation();
        setSearchOpen(false, true);
      }
      else if (!details.hidden) closeDetails(true);
      else if (!requirementsPanel.hidden) {
        requirementsPanel.hidden = true;
        requirementsButton.setAttribute('aria-expanded', 'false');
        requirementsButton.focus({ preventScroll: true });
        updateProgress();
      }
      else if (currentMode === 'explore') clearSelection();
    });
    listen(svg, 'click', function (event) {
      if (currentMode === 'explore' && !event.target.closest('.sd-node')) clearSelection();
    });
    function onOutsidePointer(event) {
      if (details.hidden || details.contains(event.target) || focusButton.contains(event.target)
        || detailsButton.contains(event.target)) return;
      var node = event.target.closest && event.target.closest('.sd-node');
      if (!node || !svg.contains(node)) closeDetails(false);
    }

    renderIssues();
    updateProgress();
    renderGraph();

    var resizeTimer;
    function onResize() {
      if (disposed) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderGraph, 150);
    }
    window.addEventListener('resize', onResize);
    var sizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(function (entries) {
      if (entries.some(function (entry) {
        return entry.contentRect.width > 0 && Math.abs(entry.contentRect.width - lastGraphWidth) > 0.5;
      })) onResize();
    }) : null;
    if (sizeObserver) sizeObserver.observe(graph);
    var styleTimer;
    var styleObserver = new MutationObserver(function () {
      if (disposed) return;
      clearTimeout(styleTimer);
      styleTimer = setTimeout(renderGraph, 100);
    });
    styleObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-font-size', 'data-theme', 'style']
    });
    document.addEventListener('pointerdown', onOutsidePointer);

    function disposeDag() {
      if (disposed) return;
      disposed = true;
      lifetime.abort();
      clearTimeout(resizeTimer);
      clearTimeout(styleTimer);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('pointerdown', onOutsidePointer);
      if (sizeObserver) sizeObserver.disconnect();
      if (styleObserver) styleObserver.disconnect();
      if (app) app.remove();
      root.classList.remove('sd-enhanced');
      delete root.dataset.seEnhanced;
      if (authorSources) authorSources.forEach(function (element) { element.classList.remove('sd-author-source'); });
    }
    return disposeDag;
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function markAuthorSource(root, model) {
    var sources = [];
    function mark(element) {
      if (element.classList.contains('sd-author-source')) return;
      sources.push(element);
      element.classList.add('sd-author-source');
    }
    root.querySelectorAll('script.sd-majors, script.sd-cats, script.sd-links, .sd-program, .sd-courses, .sd-major-desc')
      .forEach(mark);
    root.querySelectorAll('pre.syllabus').forEach(function (pre) {
      mark(pre.closest('div.sourceCode') || pre);
    });
    if (model.table) {
      var tableSource = model.table.closest('.sd-courses, .table-wrap') || model.table;
      mark(tableSource);
    }
    return sources;
  }

  function renderFatalIssues(root, issues) {
    if (!issues.errors.length) return;
    root.querySelectorAll(':scope > .sd-fatal').forEach(function (existing) { existing.remove(); });
    var panel = document.createElement('div');
    panel.className = 'sd-fatal';
    panel.setAttribute('role', 'alert');
    panel.innerHTML = '<strong>Curriculum could not be rendered.</strong><ul>'
      + issues.errors.map(function (message) { return '<li>' + escapeHtml(message) + '</li>'; }).join('')
      + '</ul>';
    root.insertBefore(panel, root.firstChild);
  }
})();
