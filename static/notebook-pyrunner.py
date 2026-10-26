import sys, io, ast, os, base64, json, re as _re

os.environ["MPLBACKEND"] = "agg"
_kb_ansi_re = _re.compile(r'\x1b\[[0-9;]*[A-Za-z]')
def _kb_strip_ansi(s):
    return _kb_ansi_re.sub('', s).replace('\r', '') if s else s

_kb_plotly_figs = []
_kb_widgets = []
_kb_widget_counter = 0
_kb_interact_funcs = {}
_kb_display_widgets = {}
_kb_ipywidgets_patched = False
_kb_display_patched = False
_kb_pending_io = []  # io_ids awaiting linkage to a display() call
_kb_display_outputs = []  # rich display outputs from display() calls


def _kb_get_rich_repr(obj):
    """Try rich repr methods in MIME priority order. Returns (mime, data) or None."""
    for attr, mime in [
        ('_repr_html_', 'html'),
        ('_repr_svg_', 'svg'),
        ('_repr_latex_', 'latex'),
        ('_repr_markdown_', 'markdown'),
    ]:
        method = getattr(obj, attr, None)
        if method is not None:
            try:
                val = method()
                if val is not None:
                    return (mime, val)
            except Exception:
                pass
    # _repr_png_ returns bytes → base64
    method = getattr(obj, '_repr_png_', None)
    if method is not None:
        try:
            val = method()
            if val is not None:
                return ('png', base64.b64encode(val).decode())
        except Exception:
            pass
    return None


def _kb_extract_widget_spec(widget):
    """Extract a control spec from an ipywidgets Widget instance."""
    import ipywidgets as widgets
    wtype = type(widget).__name__
    desc = getattr(widget, 'description', '')
    spec = {'name': desc, 'widget': wtype, 'description': desc}
    if hasattr(widget, 'value'):
        spec['value'] = widget.value
    if isinstance(widget, (widgets.IntSlider, widgets.FloatSlider)):
        spec.update(min=widget.min, max=widget.max, step=widget.step)
    elif isinstance(widget, (widgets.BoundedIntText, widgets.BoundedFloatText)):
        spec.update(min=widget.min, max=widget.max)
    elif isinstance(widget, (widgets.Dropdown, widgets.RadioButtons,
                             widgets.Select, widgets.ToggleButtons)):
        labels = list(widget._options_labels)
        spec['options'] = labels
        spec['indexed'] = True
        try:
            spec['value'] = labels.index(str(widget.label)) if widget.label else 0
        except (ValueError, AttributeError):
            spec['value'] = 0
    elif isinstance(widget, widgets.ColorPicker):
        if not spec.get('value'):
            spec['value'] = '#000000'
    return spec


def _kb_extract_widget_tree(widget):
    """Recursively extract widget tree from container widgets."""
    import ipywidgets as widgets
    wtype = type(widget).__name__

    # Container widgets: HBox, VBox, Box
    if isinstance(widget, widgets.Box):
        children = []
        for child in widget.children:
            children.append(_kb_extract_widget_tree(child))
        return {'layout': wtype, 'children': children}

    # Output widget: placeholder for output area
    if isinstance(widget, widgets.Output):
        return {'layout': 'Output', 'widget_ref': id(widget)}

    # Leaf widget: extract spec
    spec = _kb_extract_widget_spec(widget)
    spec['widget_ref'] = id(widget)
    return spec


def _kb_collect_leaf_widgets(tree, out=None):
    """Collect all leaf widget specs from a widget tree."""
    if out is None:
        out = []
    if 'layout' in tree:
        if tree['layout'] == 'Output':
            return out
        for child in tree.get('children', []):
            _kb_collect_leaf_widgets(child, out)
    else:
        out.append(tree)
    return out


def _kb_abbrev_to_control(name, abbrev):
    """Convert an interact abbreviation to a widget control spec."""
    if isinstance(abbrev, bool):
        return {'name': name, 'widget': 'Checkbox', 'value': abbrev, 'description': name}
    if isinstance(abbrev, int):
        mn = min(0, 3 * abbrev) if abbrev >= 0 else 3 * abbrev
        mx = max(0, 3 * abbrev) if abbrev <= 0 else 3 * abbrev
        if mn == mx:
            mn, mx = -10, 10
        return {'name': name, 'widget': 'IntSlider', 'value': (mn + mx) // 2,
                'min': mn, 'max': mx, 'step': 1, 'description': name}
    if isinstance(abbrev, float):
        mn = min(0.0, 3.0 * abbrev) if abbrev >= 0 else 3.0 * abbrev
        mx = max(0.0, 3.0 * abbrev) if abbrev <= 0 else 3.0 * abbrev
        if mn == mx:
            mn, mx = -10.0, 10.0
        step = round((mx - mn) / 100, 4) or 0.1
        return {'name': name, 'widget': 'FloatSlider', 'value': round((mn + mx) / 2, 4),
                'min': mn, 'max': mx, 'step': step, 'description': name}
    if isinstance(abbrev, str):
        return {'name': name, 'widget': 'Text', 'value': abbrev, 'description': name}
    if isinstance(abbrev, tuple):
        if len(abbrev) == 2:
            mn, mx = abbrev
            if isinstance(mn, float) or isinstance(mx, float):
                step = round((float(mx) - float(mn)) / 100, 4) or 0.1
                return {'name': name, 'widget': 'FloatSlider',
                        'value': round((float(mn) + float(mx)) / 2, 4),
                        'min': float(mn), 'max': float(mx), 'step': step, 'description': name}
            return {'name': name, 'widget': 'IntSlider', 'value': (mn + mx) // 2,
                    'min': mn, 'max': mx, 'step': 1, 'description': name}
        if len(abbrev) == 3:
            mn, mx, step = abbrev
            if isinstance(step, float) or isinstance(mn, float) or isinstance(mx, float):
                return {'name': name, 'widget': 'FloatSlider',
                        'value': round((float(mn) + float(mx)) / 2, 4),
                        'min': float(mn), 'max': float(mx), 'step': float(step), 'description': name}
            return {'name': name, 'widget': 'IntSlider', 'value': (mn + mx) // 2,
                    'min': mn, 'max': mx, 'step': step, 'description': name}
    if isinstance(abbrev, list):
        return {'name': name, 'widget': 'Dropdown', 'options': [str(o) for o in abbrev],
                'value': 0, 'indexed': True, 'description': name}
    if isinstance(abbrev, dict):
        labels = [str(k) for k in abbrev.keys()]
        return {'name': name, 'widget': 'Dropdown', 'options': labels,
                'value': 0, 'indexed': True, 'description': name}
    return None


def _kb_parse_interact_args(func, kwargs):
    """Fallback: parse interact arguments without ipywidgets.interactive."""
    import inspect
    controls = []
    sig = inspect.signature(func)
    params = {}
    for name, param in sig.parameters.items():
        if param.default is not inspect.Parameter.empty:
            params[name] = param.default
    params.update(kwargs)
    for name, abbrev in params.items():
        ctrl = _kb_abbrev_to_control(name, abbrev)
        if ctrl:
            controls.append(ctrl)
    return controls


def _kb_run_interact_func(func, kwargs):
    """Run an interact callback and capture output."""
    global _kb_plotly_figs
    saved_plotly = _kb_plotly_figs
    _kb_plotly_figs = []
    old_out, old_err = sys.stdout, sys.stderr
    sys.stdout = co = io.StringIO()
    sys.stderr = ce = io.StringIO()
    result = None
    error = None
    figures = []
    try:
        try:
            import plotly.graph_objects as _pgo
            _orig_show = _pgo.Figure.show
            def _ps(self, *a, **kw):
                _kb_plotly_figs.append(self.to_json())
            _pgo.Figure.show = _ps
        except ImportError:
            _orig_show = None
        result = func(**kwargs)
        if _orig_show is not None:
            _pgo.Figure.show = _orig_show
    except:
        import traceback
        error = traceback.format_exc()
    finally:
        sys.stdout, sys.stderr = old_out, old_err
    try:
        import matplotlib.pyplot as plt
        for n in plt.get_fignums():
            buf = io.BytesIO()
            plt.figure(n).savefig(buf, format='png', dpi=100, bbox_inches='tight')
            buf.seek(0)
            figures.append(base64.b64encode(buf.read()).decode())
        plt.close('all')
    except (ImportError, Exception):
        pass
    out = {
        'stdout': _kb_strip_ansi(co.getvalue()),
        'stderr': _kb_strip_ansi(ce.getvalue()),
        'result': repr(result) if result is not None else None,
        'figures': figures,
        'plotly': list(_kb_plotly_figs),
        'error': error,
    }
    _kb_plotly_figs = saved_plotly
    return out


def _kb_display_callback(widget_id, values_json):
    """Called from JS when display widget values change. Fires observe callbacks."""
    info = _kb_display_widgets.get(widget_id)
    if not info:
        return json.dumps({'error': 'Widget not found: ' + widget_id})
    values = json.loads(values_json)

    # If interactive_output is linked, call the function directly
    io_id = info.get('io_id')
    if io_id and io_id in _kb_interact_funcs:
        io_info = _kb_interact_funcs[io_id]
        io_controls = io_info.get('io_controls', {})
        actual = {}
        for param_name, widget in io_controls.items():
            desc = getattr(widget, 'description', param_name)
            if desc in values:
                actual[param_name] = values[desc]
            else:
                actual[param_name] = widget.value
        return json.dumps(_kb_run_interact_func(io_info['func'], actual))

    widget_map = info['widget_map']
    output_widget = info.get('output_widget')

    # Update widget .value properties and fire .observe() callbacks
    global _kb_plotly_figs
    saved_plotly = _kb_plotly_figs
    _kb_plotly_figs = []
    old_out, old_err = sys.stdout, sys.stderr
    sys.stdout = co = io.StringIO()
    sys.stderr = ce = io.StringIO()
    error = None
    figures = []

    try:
        # Patch plotly
        try:
            import plotly.graph_objects as _pgo
            _orig_show = _pgo.Figure.show
            def _ps(self, *a, **kw):
                _kb_plotly_figs.append(self.to_json())
            _pgo.Figure.show = _ps
        except ImportError:
            _orig_show = None

        # If output_widget exists, capture into it
        if output_widget is not None:
            output_widget.clear_output(wait=True)

        for desc, val in values.items():
            w = widget_map.get(desc)
            if w is not None:
                try:
                    w.value = val
                except Exception:
                    pass

        if _orig_show is not None:
            _pgo.Figure.show = _orig_show
    except:
        import traceback
        error = traceback.format_exc()
    finally:
        sys.stdout, sys.stderr = old_out, old_err

    try:
        import matplotlib.pyplot as plt
        for n in plt.get_fignums():
            buf = io.BytesIO()
            plt.figure(n).savefig(buf, format='png', dpi=100, bbox_inches='tight')
            buf.seek(0)
            figures.append(base64.b64encode(buf.read()).decode())
        plt.close('all')
    except (ImportError, Exception):
        pass

    out = {
        'stdout': _kb_strip_ansi(co.getvalue()),
        'stderr': _kb_strip_ansi(ce.getvalue()),
        'result': None,
        'figures': figures,
        'plotly': list(_kb_plotly_figs),
        'error': error,
    }
    _kb_plotly_figs = saved_plotly
    return json.dumps(out)


def _kb_interact_callback(widget_id, values_json):
    """Called from JS when widget values change."""
    info = _kb_interact_funcs.get(widget_id)
    if not info:
        return json.dumps({'error': 'Widget not found: ' + widget_id})
    values = json.loads(values_json)
    mappings = info.get('mappings', {})
    actual = {}
    for name, val in values.items():
        if name in mappings:
            actual[name] = mappings[name][val]
        else:
            actual[name] = val
    return json.dumps(_kb_run_interact_func(info['func'], actual))


def _kb_setup_display():
    """Patch builtins.display to capture rich MIME output (always, even without ipywidgets)."""
    global _kb_display_patched
    if _kb_display_patched:
        return
    _kb_display_patched = True
    import builtins
    _orig_display = getattr(builtins, 'display', None)

    def _rich_display(*objs, **kwargs):
        for obj in objs:
            rich = _kb_get_rich_repr(obj)
            if rich:
                _kb_display_outputs.append({rich[0]: rich[1]})
            elif _orig_display:
                _orig_display(obj, **kwargs)
            else:
                print(repr(obj))

    builtins.display = _rich_display

    # Also patch IPython.display.display if available
    try:
        import IPython.display as _ipd
        _ipd.display = _rich_display
    except ImportError:
        pass
    try:
        import IPython.core.display_functions as _idf
        _idf.display = _rich_display
    except (ImportError, AttributeError):
        pass


def _kb_setup_ipywidgets():
    """Patch ipywidgets.interact to capture widget output."""
    global _kb_ipywidgets_patched
    if _kb_ipywidgets_patched:
        return
    _kb_setup_display()
    try:
        import ipywidgets as widgets
    except ImportError:
        return
    _kb_ipywidgets_patched = True
    _orig_interactive = widgets.interactive

    def _capture_interact(__interact_f=None, **kwargs):
        global _kb_widget_counter
        if __interact_f is None:
            def decorator(f):
                _capture_interact(f, **kwargs)
                return f
            return decorator
        widget_id = 'iw_' + str(_kb_widget_counter)
        _kb_widget_counter += 1
        controls = []
        mappings = {}
        try:
            w = _orig_interactive(__interact_f, **kwargs)
            for child in w.children:
                if isinstance(child, widgets.Output):
                    continue
                ctrl = _kb_extract_widget_spec(child)
                if ctrl:
                    if ctrl.get('indexed') and hasattr(child, '_options_values'):
                        mappings[ctrl['name']] = list(child._options_values)
                    controls.append(ctrl)
        except Exception:
            controls = _kb_parse_interact_args(__interact_f, kwargs)
        _kb_interact_funcs[widget_id] = {
            'func': __interact_f,
            'mappings': mappings,
            'controls': controls,
        }
        defaults = {}
        for ctrl in controls:
            name = ctrl['name']
            val = ctrl['value']
            if name in mappings:
                defaults[name] = mappings[name][val]
            else:
                defaults[name] = val
        initial = _kb_run_interact_func(__interact_f, defaults)
        _kb_widgets.append({
            'type': 'interact',
            'id': widget_id,
            'controls': controls,
            'initial_output': initial,
        })

    widgets.interact = _capture_interact
    widgets.interact_manual = _capture_interact

    # Upgrade display() to also handle widget trees (extends _kb_setup_display)
    import builtins
    _basic_display = builtins.display  # already patched by _kb_setup_display

    def _widget_display(*objs, **kwargs):
        global _kb_widget_counter
        has_widget = False
        try:
            for obj in objs:
                if isinstance(obj, widgets.Widget):
                    has_widget = True
                    break
        except Exception:
            pass
        if not has_widget:
            _basic_display(*objs, **kwargs)
            return

        # Collect all displayed widget trees and the output widget
        trees = []
        output_widget = None
        widget_map = {}  # description -> widget instance
        for obj in objs:
            if isinstance(obj, widgets.Output):
                output_widget = obj
                continue
            if isinstance(obj, widgets.Widget):
                tree = _kb_extract_widget_tree(obj)
                trees.append(tree)
                # Build widget_map from leaf widgets
                def _map_leaves(w, parent_widget):
                    if isinstance(parent_widget, widgets.Box):
                        for child in parent_widget.children:
                            _map_leaves(child, child)
                    elif isinstance(parent_widget, widgets.Output):
                        pass
                    else:
                        desc = getattr(parent_widget, 'description', '')
                        if desc:
                            widget_map[desc] = parent_widget
                _map_leaves(obj, obj)

        widget_id = 'dw_' + str(_kb_widget_counter)
        _kb_widget_counter += 1

        dw_info = {
            'widget_map': widget_map,
            'output_widget': output_widget,
        }
        # Link pending interactive_output registration if an Output widget is present
        io_id = None
        if output_widget is not None and _kb_pending_io:
            io_id = _kb_pending_io.pop(0)
            dw_info['io_id'] = io_id
        sys.__stderr__.write('[KB_DEBUG] _patched_display: output_widget=' + str(output_widget is not None) + ', io_id=' + str(io_id) + ', pending=' + str(_kb_pending_io) + ', widget_map_keys=' + str(list(widget_map.keys())) + '\n')
        _kb_display_widgets[widget_id] = dw_info

        # Collect all leaf controls for flat listing
        all_controls = []
        for tree in trees:
            all_controls.extend(_kb_collect_leaf_widgets(tree))

        # If interactive_output is linked, call the function for initial output
        initial_output = {'stdout': '', 'stderr': '', 'result': None,
                          'figures': [], 'plotly': [], 'error': None}
        if io_id is not None and io_id in _kb_interact_funcs:
            io_info = _kb_interact_funcs[io_id]
            io_controls = io_info.get('io_controls', {})
            current_values = {k: w.value for k, w in io_controls.items()}
            sys.__stderr__.write('[KB_DEBUG] calling _kb_run_interact_func for initial output, params=' + str(list(current_values.keys())) + '\n')
            initial_output = _kb_run_interact_func(io_info['func'], current_values)
            sys.__stderr__.write('[KB_DEBUG] initial_output: plotly_count=' + str(len(initial_output.get('plotly', []))) + ', figures_count=' + str(len(initial_output.get('figures', []))) + ', error=' + str(initial_output.get('error')) + ', stdout_len=' + str(len(initial_output.get('stdout', ''))) + '\n')

        _kb_widgets.append({
            'type': 'display',
            'id': widget_id,
            'trees': trees,
            'controls': all_controls,
            'has_output': output_widget is not None,
            'initial_output': initial_output,
        })

    builtins.display = _widget_display

    # Also patch IPython.display.display so `from IPython.display import display` picks it up
    try:
        import IPython.display as _ipd
        _ipd.display = _widget_display
    except ImportError:
        pass
    try:
        import IPython.core.display_functions as _idf
        _idf.display = _widget_display
    except (ImportError, AttributeError):
        pass

    # Patch interactive_output to store func+controls for direct callback
    _orig_interactive_output = getattr(widgets, 'interactive_output', None)

    def _patched_interactive_output(f, controls):
        global _kb_widget_counter
        io_id = 'io_' + str(_kb_widget_counter)
        _kb_widget_counter += 1
        _kb_interact_funcs[io_id] = {
            'func': f,
            'mappings': {},
            'controls': [],
            'io_controls': controls,  # {param_name: widget_instance}
        }
        _kb_pending_io.append(io_id)
        sys.__stderr__.write('[KB_DEBUG] interactive_output called, io_id=' + io_id + ', pending=' + str(_kb_pending_io) + '\n')
        # Return a plain Output widget (user may or may not display it)
        return widgets.Output()

    if _orig_interactive_output is not None:
        widgets.interactive_output = _patched_interactive_output


def _kb_run(code):
    global _kb_plotly_figs, _kb_widgets, _kb_display_outputs
    _kb_plotly_figs = []
    _kb_widgets = []
    _kb_display_outputs = []
    _kb_setup_ipywidgets()
    old_out, old_err = sys.stdout, sys.stderr
    sys.stdout = _co = io.StringIO()
    sys.stderr = _ce = io.StringIO()
    result = None
    error = None
    figures = []
    try:
        # Patch plotly show() to capture figure JSON
        try:
            import plotly.graph_objects as _pgo
            _orig_show = _pgo.Figure.show

            def _patched_show(self, *a, **kw):
                _kb_plotly_figs.append(self.to_json())

            _pgo.Figure.show = _patched_show
        except ImportError:
            _orig_show = None
        tree = ast.parse(code)
        last = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last = ast.Expression(tree.body.pop().value)
            ast.fix_missing_locations(last)
        if tree.body:
            exec(compile(tree, "<cell>", "exec"), globals())
        if last is not None:
            result = eval(compile(last, "<cell>", "eval"), globals())
        if _orig_show is not None:
            _pgo.Figure.show = _orig_show
    except:
        import traceback
        error = traceback.format_exc()
    finally:
        sys.stdout, sys.stderr = old_out, old_err
    try:
        import matplotlib.pyplot as plt
        for n in plt.get_fignums():
            buf = io.BytesIO()
            plt.figure(n).savefig(buf, format="png", dpi=100, bbox_inches="tight")
            buf.seek(0)
            figures.append(base64.b64encode(buf.read()).decode())
        plt.close("all")
    except (ImportError, Exception):
        pass

    # If there are display widgets with output, move plotly/figures into the
    # widget's initial_output so updates replace in the same area.
    # Skip if initial_output was already populated (e.g. by interactive_output).
    for w in _kb_widgets:
        if w.get('type') == 'display' and w.get('has_output'):
            existing = w.get('initial_output') or {}
            sys.__stderr__.write('[KB_DEBUG] _kb_run post: widget ' + w.get('id', '?') + ' existing plotly=' + str(len(existing.get('plotly', []))) + ', figures=' + str(len(existing.get('figures', []))) + ', global plotly=' + str(len(_kb_plotly_figs)) + '\n')
            if existing.get('plotly') or existing.get('figures'):
                continue  # already populated by interactive_output
            w['initial_output'] = {
                'stdout': _kb_strip_ansi(_co.getvalue()),
                'stderr': '',
                'result': None,
                'figures': figures,
                'plotly': list(_kb_plotly_figs),
                'error': None,
            }
            # Clear from main output so they don't appear twice
            figures = []
            _kb_plotly_figs = []
            break

    # MIME negotiation for last expression result
    result_html = None
    result_svg = None
    result_latex = None
    result_text = None
    if result is not None and error is None:
        rich = _kb_get_rich_repr(result)
        if rich:
            if rich[0] == 'html':
                result_html = rich[1]
            elif rich[0] == 'svg':
                result_svg = rich[1]
            elif rich[0] == 'latex':
                result_latex = rich[1]
            elif rich[0] == 'png':
                figures.append(rich[1])
            else:
                result_text = repr(result)
        else:
            result_text = repr(result)

    return {
        "stdout": _kb_strip_ansi(_co.getvalue()),
        "stderr": _kb_strip_ansi(_ce.getvalue()),
        "result": result_text,
        "html": result_html,
        "svg": result_svg,
        "latex": result_latex,
        "figures": figures,
        "plotly": _kb_plotly_figs,
        "error": error,
        "widgets": _kb_widgets,
        "display_outputs": _kb_display_outputs if _kb_display_outputs else None,
    }


def _kb_run_json(code):
    """Wrapper that returns _kb_run result as a JSON string (for Web Worker)."""
    return json.dumps(_kb_run(code))
