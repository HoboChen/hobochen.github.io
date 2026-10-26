(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('js-yaml'));
  } else {
    root.SyllabusSpec = factory(root.jsyaml);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (yaml) {
  'use strict';

  var MAX_SOURCE_LENGTH = 256 * 1024;
  var MAX_MEMBERS = 512;

  function record(value, label, allowed) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(label + ' must be a mapping.');
    }
    if (allowed) {
      Object.keys(value).forEach(function (key) {
        if (allowed.indexOf(key) === -1) throw new Error(label + ': unknown field "' + key + '".');
      });
    }
    return value;
  }

  function string(value, label) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(label + ' must be nonempty text.');
    }
    return value.trim();
  }

  function list(value, label) {
    if (!Array.isArray(value) || !value.length || value.length > MAX_MEMBERS) {
      throw new Error(label + ' must be a list of 1-' + MAX_MEMBERS + ' members.');
    }
    return value;
  }

  function count(value, label) {
    var raw = typeof value === 'number' ? String(value) : value;
    if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
      throw new Error(label + ' must be a positive integer.');
    }
    return Number(raw);
  }

  function unique(values) {
    return Array.from(new Set(values));
  }

  function groupExpander(groups) {
    var cache = new Map();
    var pending = new Set();
    function expand(tokens) {
      var result = [];
      tokens.forEach(function (value) {
        var token = string(value, 'Course or group reference');
        if (token.indexOf('group:') !== 0) {
          result.push(token);
        } else {
          var id = token.substring(6);
          if (!Object.prototype.hasOwnProperty.call(groups, id)) {
            throw new Error('Unknown group: ' + id + '.');
          }
          if (pending.has(id)) throw new Error('Cyclic group reference: ' + id + '.');
          if (!cache.has(id)) {
            if (pending.size >= 64) throw new Error('Group nesting exceeds 64 levels.');
            pending.add(id);
            cache.set(id, expand(groups[id]));
            pending.delete(id);
          }
          result = result.concat(cache.get(id));
        }
        if (result.length > MAX_MEMBERS) {
          result = unique(result);
          if (result.length > MAX_MEMBERS) throw new Error('Expanded group exceeds ' + MAX_MEMBERS + ' members.');
        }
      });
      return unique(result);
    }
    Object.keys(groups).forEach(function (id) { expand(['group:' + id]); });
    return expand;
  }

  function compileRule(specification, expand) {
    var spec = record(specification, 'Requirement', ['take', 'from', 'each', 'manual', 'note']);
    var note = spec.note === undefined ? '' : string(spec.note, 'Requirement note');
    var rule = {
      kind: 'manual', count: 1, perGroup: 1, candidates: [], tags: [], groups: [], note: note
    };
    if (spec.manual !== undefined) {
      if (spec.take !== undefined || spec.from !== undefined || spec.each !== undefined) {
        throw new Error('A manual requirement cannot also declare take/from/each.');
      }
      rule.note = string(spec.manual, 'Manual requirement') + (note ? ' ' + note : '');
      return rule;
    }
    var takeAll = spec.take === 'all';
    var take = takeAll ? null : count(spec.take, 'take');
    var from = list(spec.from, 'from');

    if (spec.each !== undefined) {
      rule.kind = 'distinct-groups';
      rule.count = takeAll ? from.length : take;
      rule.perGroup = count(spec.each, 'each');
      var groupKeys = new Set();
      rule.groups = from.map(function (item, index) {
        if (!Array.isArray(item) && (typeof item !== 'string' || !/^(group:|tag:)/.test(item))) {
          throw new Error('each requires named groups, tag pools, or lists of course IDs.');
        }
        var groupKey = Array.isArray(item) ? JSON.stringify(item.slice().sort()) : item;
        if (groupKeys.has(groupKey)) throw new Error('each cannot count the same group more than once.');
        groupKeys.add(groupKey);
        var tokens = expand(Array.isArray(item) ? list(item, 'Group members') : [item]);
        return {
          id: 'group-' + index,
          label: Array.isArray(item) ? item.join(', ') : item.replace(/^(group:|tag:)/, ''),
          tokens: tokens
        };
      });
      return rule;
    }

    if (from.some(Array.isArray)) {
      var choices = [];
      from.forEach(function (item) {
        if (Array.isArray(item)) {
          var tokens = expand(list(item, 'Bundle'));
          choices.push({ label: tokens.join(' + '), tokens: tokens });
        } else {
          expand([item]).forEach(function (token) {
            choices.push({ label: token, tokens: [token] });
          });
        }
      });
      var seen = new Set();
      rule.groups = choices.filter(function (choice) {
        var key = JSON.stringify(choice.tokens.slice().sort());
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).map(function (choice, index) {
        return { id: 'choice-' + index, label: choice.label, tokens: choice.tokens };
      });
      rule.kind = 'any-of';
      rule.count = takeAll ? rule.groups.length : take;
      return rule;
    }

    rule.kind = takeAll ? 'all' : 'choose';
    rule.candidates = expand(from);
    rule.count = takeAll ? rule.candidates.length : take;
    return rule;
  }

  function parseConfig(source) {
    if (typeof source !== 'string' || !source.trim() || source.length > MAX_SOURCE_LENGTH) {
      throw new Error('Syllabus YAML must contain 1-' + MAX_SOURCE_LENGTH + ' characters.');
    }
    if (!yaml) throw new Error('The YAML parser is unavailable.');
    // Course codes are identifiers: 18.100 and 6.3700 must never become numbers.
    var config = record(yaml.load(source, { schema: yaml.FAILSAFE_SCHEMA }), 'Syllabus', [
      'key', 'default', 'groups', 'programs'
    ]);
    var key = string(config.key, 'Syllabus key');
    var definitions = record(config.programs, 'programs');
    var programIds = Object.keys(definitions);
    if (!programIds.length) throw new Error('At least one program is required.');
    var defaultProgram = config.default === undefined ? programIds[0] : string(config.default, 'Default program');
    if (programIds.indexOf(defaultProgram) === -1) throw new Error('Unknown default program: ' + defaultProgram + '.');
    var groups = config.groups === undefined ? Object.create(null) : record(config.groups, 'groups');
    Object.keys(groups).forEach(function (id) {
      string(id, 'Group name');
      list(groups[id], 'Group ' + id).forEach(function (member) {
        string(member, 'Member of group ' + id);
      });
    });
    var expand = groupExpander(groups);
    var programs = programIds.map(function (id) {
      string(id, 'Program identifier');
      var definition = record(definitions[id], 'Program ' + id, ['name', 'requirements']);
      var requirements = record(definition.requirements, 'Requirements for ' + id);
      var rules = Object.keys(requirements).map(function (label) {
        string(label, 'Requirement name');
        try {
          return Object.assign(compileRule(requirements[label], expand), {
            id: id + '/' + label,
            programId: id,
            label: label
          });
        } catch (error) {
          throw new Error(id + ' / ' + label + ': ' + error.message);
        }
      });
      return { id: id, name: string(definition.name, 'Name of ' + id), rules: rules };
    });
    return { key: key, defaultProgram: defaultProgram, programs: programs };
  }

  return Object.freeze({ parseConfig: parseConfig });
});
