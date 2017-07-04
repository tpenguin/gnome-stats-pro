/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const GTop = imports.gi.GTop;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const St = imports.gi.St;
const Shell = imports.gi.Shell;

// requires RPMs: NetworkManager-libnm-devel
const NMClient = imports.gi.NMClient;
const NetworkManager = imports.gi.NetworkManager;

const Main = imports.ui.main;
const Tweener = imports.ui.tweener;

// FIXME: Add gettext...
//const Gettext = imports.gettext.domain('gnome-shell-extensions');
//const _ = Gettext.gettext;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

const INDICATOR_UPDATE_INTERVAL = 250;
const INDICATOR_NUM_GRID_LINES = 3;

const ITEM_LABEL_SHOW_TIME = 0.15;
const ITEM_LABEL_HIDE_TIME = 0.1;
const ITEM_HOVER_TIMEOUT = 300;

// TODO: Prototype this onto Object class...
function merge_options(obj1, obj2) {
    var obj3 = {};
    for (let attrname in obj1) { obj3[attrname] = obj1[attrname]; }
    for (let attrname in obj2) { obj3[attrname] = obj2[attrname]; }
    return obj3;
}

Number.prototype.formatMetricPretty = function(units) {
    let value = this;
    let metricPrefix = "";

    if (value > 1024 * 1024) {
        value /= 1024 * 1024;
        metricPrefix = "Mi";
    } else if (value > 1024) {
        value /= 1024;
        metricPrefix = "Ki";
    }

    return "%0.2f %s%s".format(value, metricPrefix, units || "");
};

function GraphOverlay(options) {
    this.label = undefined;

    this._init(options);
}

GraphOverlay.prototype = {
    Name: 'GnomeStatsPro.GraphOverlay',

    _init: function() {
        this.label = new St.Label({style_class:'label'});

        this.actor = new St.Bin({
            style_class:'gsp-graph-overlay',
            reactive: true,
            x_fill: true,
            y_fill: true
        });

        this.actor.add_actor(this.label);

        Main.layoutManager.addChrome(this.actor);
        this.actor.hide();
    },

    destroy: function() {
        this.actor.destroy();
    }
};

function HorizontalGraph(options) {
    this.graph = undefined;
    this.renderStats = [];
    this.stats = {};
    this.max = -1;
    this.options = {
        updateInterval: INDICATOR_UPDATE_INTERVAL,
        offsetX: 2,
        offsetY: -1,
        units: '',
        gridColor: '-grid-color',
        autoscale: true,
        showMax: true,
        max: 0
    };

    this._init(options);

    if (!this.options.autoscale) {
        this.max = this.options.max;
        this._updateMaxLabel();
    }
}

HorizontalGraph.prototype = {
    Name: 'HorizontalGraph',

    _init: function(options) {
        this.options = merge_options(this.options, options || {});

        this.graph = new St.DrawingArea({reactive: true});
        this.graph.connect('repaint', Lang.bind(this, this._draw));

        this.actor = new St.Bin({
            style_class: 'gsp-graph-area',
            reactive: true,
            x_fill: true,
            y_fill: true
        });
        this.actor.add_actor(this.graph);

        this.graphoverlay = new GraphOverlay;

        this._timeout = Mainloop.timeout_add(this.options.updateInterval, Lang.bind(this, function() {
            if (this.graph.visible) {
                this.graph.queue_repaint();
            }
            return true;
        }));
    },

    destroy: function() {
        Mainloop.source_remove(this._timeout);

        this.actor.destroy();
    },

    addDataSet: function(name, color) {
        this.renderStats.push(name);
        this.stats[name] = {color: color, values: [], scaled: [], max: -1};
    },

    addDataPoint: function(name, value) {
        this.stats[name].values.push(value);
    },

    // Calculate maximum value within set of values.
    _updateDataSetMax: function(name) {
        this.stats[name].max = this.stats[name].values.reduce(function (prev, cur) {
            return Math.max(prev, cur);
        }, 0);

        if (this.max < this.stats[name].max) {
            this.max = this.stats[name].max;
            this._updateMaxLabel();
        }
    },

    _updateMax: function() {
        let max = 0;

        this.renderStats.map(Lang.bind(this, function(k){
            max = Math.max(this.stats[k].max, max);
        }));

        if (max < this.max) {
            this.max = max;
            this._updateMaxLabel();
        }
    },

    _updateMaxLabel: function() {
        if (this.options.showMax) {
            this.graphoverlay.label.set_text(this.max.formatMetricPretty(this.options.units));
        }
    },

    // Used to draws major/minor division lines within the graph.
    _drawGridLines: function(cr, width, gridOffset, count, color) {
        for (let i = 1; i <= count; ++i) {
            cr.moveTo(0, i * gridOffset + .5);
            cr.lineTo(width, i * gridOffset + .5);
        }
        Clutter.cairo_set_source_color(cr, color);
        cr.setLineWidth(1);
        cr.setDash([2,1], 0);
        cr.stroke();
    },

    _draw: function(area) {
        let [width, height] = area.get_surface_size();
        let themeNode = this.actor.get_theme_node();
        let cr = area.get_context();

        //draw the background grid
        let color = themeNode.get_color(this.options.gridColor);
        let gridOffset = Math.floor(height / (INDICATOR_NUM_GRID_LINES + 1));

        // draws major divisions
        this._drawGridLines(cr, width, gridOffset, INDICATOR_NUM_GRID_LINES, color);

        // draws minor divisions
        color.alpha = color.alpha * 0.2;
        this._drawGridLines(cr, width, gridOffset/2, INDICATOR_NUM_GRID_LINES * 2 + 1, color);

        let renderStats = this.renderStats;
        renderStats.map(Lang.bind(this, function(k){
            let stat = this.stats[k];
            let new_width = width + 1;

            // truncate data point values to width of graph
            if (stat.values.length > new_width) {
                stat.values = stat.values.slice(stat.values.length - new_width, stat.values.length);
            }

            if (this.options.autoscale) {
                // Calculate maximum value within set of stat.values
                this._updateDataSetMax(k);
            }
        }));

        if (this.options.autoscale) {
            // Fixes max over all data points.
            this._updateMax();
        }

        // Scale all data points over max
        renderStats.map(Lang.bind(this, function(k){
            this.stats[k].scaled = this.stats[k].values.map(Lang.bind(this, function (cur) {
                return cur / this.max;
            }));
        }));

        for (let i = 0; i < renderStats.length; ++i) {
            let stat = this.stats[renderStats[i]];
            let outlineColor = themeNode.get_color(stat.color);

            if (i == 0) {
                let color = new Clutter.Color(outlineColor);
                color.alpha = color.alpha * 0.2;

                // Render the first dataset's fill
                this._plotDataSet(cr, height, stat.scaled);
                cr.lineTo(stat.scaled.length - 1, height);
                cr.lineTo(0, height);
                cr.closePath();
                Clutter.cairo_set_source_color(cr, color);
                cr.fill();
            }

            // Render the data points
            this._plotDataSet(cr, height, stat.scaled);
            Clutter.cairo_set_source_color(cr, outlineColor);
            cr.setLineWidth(1.0);
            cr.setDash([], 0);
            cr.stroke();
        }
    },

    _plotDataSet: function(cr, height, values) {
        cr.moveTo(0, (1 - values[0]) * height);
        for (let k = 1; k < values.length; ++k) {
            cr.lineTo(k, (1 - values[k]) * height);
        }
    },

    setOverlayPosition: function(x, y) {
        this.graphoverlay.actor.set_position(x + this.options.offsetX,
                                             y + this.options.offsetY);
    },

    show: function() {
        this.graphoverlay.actor.show();
        this.graphoverlay.actor.opacity = 0;

        Tweener.addTween(this.graphoverlay.actor,
                         {
                             opacity: 255,
                             time: ITEM_LABEL_SHOW_TIME,
                             transition: 'easeOutQuad'
                         });
    },

    hide: function() {
        this.graphoverlay.actor.hide();
    }
};

const Indicator = new Lang.Class({
    Name: 'GnomeStatsPro.Indicator',

    options: {
        updateInterval: INDICATOR_UPDATE_INTERVAL,
        barPadding: 1,
        barWidth: 6,
        gridColor: '-grid-color'
    },

    ready: false,

    _init: function(options) {
        // process optionals
        this.options = merge_options(this.options, options || {});
        this.stats = {};
        this.renderStats = [];

        this._barPadding = this.options.barPadding;
        this._barWidth = this.options.barWidth;

        // permit subclass to optionally initialize
        this._initValues();

        // create UI elements
        this.drawing_area = new St.DrawingArea({ reactive: true });
        this.drawing_area.connect('repaint', Lang.bind(this, this._draw));
        this.drawing_area.connect('button-press-event', function() {
            let app = Shell.AppSystem.get_default().lookup_app('gnome-system-monitor.desktop');
            app.open_new_window(-1);
            return true;
        });

        this.actor = new St.Bin({ style_class: "gsp-indicator",
                                  reactive: true, track_hover: true,
                                  x_fill: true, y_fill: true });
        this.actor.add_actor(this.drawing_area);

        this.resized = false;

        this.dropdown = new St.Widget({
            layout_manager: new Clutter.GridLayout(),
            reactive: true,
            style_class: 'gsp-dropdown'
        });
        Main.layoutManager.addChrome(this.dropdown);
        this.dropdown.hide();

        this._timeout = Mainloop.timeout_add(this.options.updateInterval, Lang.bind(this, function () {
            if (this.ready) {
                this._updateValues();
                this.drawing_area.queue_repaint();
            }
            return true;
        }));
    },

    addDataSet: function(name, color) {
        this.renderStats.push(name);
        this.stats[name] = {color: color, values: []};
    },

    addDataPoint: function(name, value) {
        this.stats[name].values.push(value);
    },

    enable: function() {
        this.ready = true;
    },

    showPopup: function(graph) {
        this.dropdown.opacity = 0;
        this.dropdown.show();

        let [stageX, stageY] = this.actor.get_transformed_position();

	    let itemWidth = this.actor.allocation.x2 - this.actor.allocation.x1;
        let itemHeight = this.actor.allocation.y2 - this.actor.allocation.y1;

	    let labelWidth = this.dropdown.width;
        let labelHeight = this.dropdown.height;
        let xOffset = Math.floor((itemWidth - labelWidth) / 2);

        let x = stageX + xOffset;

        let node = this.dropdown.get_theme_node();
        let yOffset = node.get_length('-y-offset');

        let y = stageY + itemHeight + yOffset;

        this.dropdown.set_position(x, y);

        Tweener.addTween(
            this.dropdown,
            {
                opacity: 255,
                time: ITEM_LABEL_SHOW_TIME,
                transition: 'easeOutQuad',
                onComplete: function() {
                    if (graph !== undefined) {
                        let [x1, y1] = graph.actor.get_position();
                        graph.setOverlayPosition(x + x1, y + y1);
                        graph.show();
                    }
                }
            });
    },

    hidePopup: function (graph) {
        Tweener.addTween(
            this.dropdown,
            {
                opacity: 0,
                time: ITEM_LABEL_HIDE_TIME,
                transition: 'easeOutQuad',
                onComplete: Lang.bind(this, function() {
                    graph.hide();
                    this.dropdown.hide();
                })
            });
    },

    destroy: function() {
        Mainloop.source_remove(this._timeout);

        this.actor.destroy();
    },

    _createPanel: function() {
    },

    _destroyPanel: function() {
    },

    onShowPanel: function() {
    },

    onHidePanel: function() {
    },

    _initValues: function() {
    },

    _updateValues: function() {
    },

    _draw: function(area) {
        if (!this.ready) return;

        let [width, height] = area.get_surface_size();
        let cr = area.get_context();
        let themeNode = this.actor.get_theme_node();

        //resize container based on number of bars to chart
        if (this.resized === undefined || !this.resized) {
            this.actor.set_width(this.renderStats.length * (this._barWidth + this._barPadding) + this._barPadding * 2.0 - 1);
            this.resized = true;
        }

        //draw the background grid
        let color = themeNode.get_color(this.options.gridColor);
        let gridOffset = Math.floor(height / (INDICATOR_NUM_GRID_LINES + 1));
        for (let i = 1; i <= INDICATOR_NUM_GRID_LINES; ++i) {
            cr.moveTo(0, i * gridOffset + .5);
            cr.lineTo(width, i * gridOffset + .5);
        }
        Clutter.cairo_set_source_color(cr, color);
        cr.setLineWidth(1);
        cr.setDash([2,1], 0);
        cr.stroke();

        let renderStats = this.renderStats;

        // Make sure we don't have more sample points than pixels
        renderStats.map(Lang.bind(this, function(k){
            let stat = this.stats[k];
            let keepNumStats = 3;

            if (stat.values.length > keepNumStats) {
                stat.values = stat.values.slice(stat.values.length - keepNumStats, stat.values.length);
            }
        }));

        for (let i = 0; i < renderStats.length; ++i) {
            let stat = this.stats[renderStats[i]];
            // We outline at full opacity and fill with 40% opacity
            let outlineColor = themeNode.get_color(stat.color);
            let color = new Clutter.Color(outlineColor);
            color.alpha = color.alpha * .8;

            // Render the bar graph's fill
            this._plotDataSet(cr, height, i, stat.values, false);
            cr.lineTo((i + 1) * (this._barWidth + this._barPadding), height);
            cr.lineTo(i * (this._barWidth + this._barPadding) + this._barPadding, height);
            cr.closePath();
            Clutter.cairo_set_source_color(cr, color);
            cr.fill();

            // Render the bar graph's height line
            this._plotDataSet(cr, height, i, stat.values, false, .5);
            Clutter.cairo_set_source_color(cr, outlineColor);
            cr.setLineWidth(1.0);
            cr.setDash([], 0);
            cr.stroke();
        }
    },

    _plotDataSet: function(cr, height, position, values, reverse, nudge = 0) {
        let barOuterWidth = this._barWidth + this._barPadding;
        let barHeight = 1 - values[0];

        cr.moveTo(position * barOuterWidth + this._barPadding, barHeight * height + nudge);
        cr.lineTo((position + 1) * barOuterWidth, barHeight * height + nudge);
    }
});

const CpuIndicator = new Lang.Class({
    Name: 'GnomeStatsPro.CpuIndicator',
    Extends: Indicator,

    _init: function() {
        this.parent({
            updateInterval: 250,
            decay: 0.2
        });

        this.current_label = new St.Label({style_class:'title_label'});
        this.current_label.set_text("Current:");

        this.current_cpu_label = new St.Label({style_class:'description_label'});
        this.current_cpu_label.set_text("Total CPU usage");
        this.current_cpu_value = new St.Label({style_class:'value_label'});

        let layout = this.dropdown.layout_manager;

        this.cpu_graph = new HorizontalGraph({autoscale: false, max: 100, units: '%', showMax: false});
        this.cpu_graph.addDataSet('cpu-usage', '-cpu-color');

        layout.attach(this.cpu_graph.actor, 0, 0, 2, 1);

        let x = 0, y = 1;
        layout.attach(this.current_label, x+0, y+0, 2, 1);
        layout.attach(this.current_cpu_label, x+0, y+1, 1, 1);
        layout.attach(this.current_cpu_value, x+1, y+1, 1, 1);
    },

    _initValues: function() {
        this._prev = new GTop.glibtop_cpu;
        GTop.glibtop_get_cpu(this._prev);

        // get number of cores
        this.ncpu = 1;

        let gtop = new GTop.glibtop_cpu();
        try {
            this.ncpu = GTop.glibtop_get_sysinfo().ncpu;
        } catch(e) {
            global.logError(e);
        }

        this._pcpu = [];

        // populate statistics variables
        for (let cpu = 0; cpu < this.ncpu; cpu++) {
            let key = 'cpu_' + cpu;

            this.addDataSet(key, "-cpu-color");
            this._pcpu[cpu] = 0;
        }

        this.enable();
    },

    _updateValues: function() {
        // Query current iteration CPU statistics
        let cpu = new GTop.glibtop_cpu;
        let cpu_ttl_usage = 0;

        GTop.glibtop_get_cpu(cpu);

        // Collect per-CPU statistics
        for (var i=0; i<this.ncpu; ++i) {
            let total = Math.max(cpu.xcpu_total[i] - this._prev.xcpu_total[i], 0);
            let idle = Math.max(cpu.xcpu_idle[i] - this._prev.xcpu_idle[i], 0);
            let key = 'cpu_' + i;

            let reading = 0;
            if (total > 0) {
                reading = 1.0 - (idle / total);
            }

            cpu_ttl_usage += reading;

            let decayed_value = Math.min(this._pcpu[i] * this.options.decay, 0.999999999);
            let value = Math.max(reading, decayed_value);

            this.addDataPoint(key, value);

            this._pcpu[i] = value;
        }

        cpu_ttl_usage /= this.ncpu;
        cpu_ttl_usage *= 100;
        this.cpu_graph.addDataPoint('cpu-usage', cpu_ttl_usage);

        let cpu_ttl_text = "%s%%".format(cpu_ttl_usage.formatMetricPretty(''));
        this.current_cpu_value.set_text(cpu_ttl_text);

        // Store this iteration for next calculation run
        this._prev = cpu;
    },

    showPopup: function() {
        this.parent(this.cpu_graph);
    },

    hidePopup: function() {
        this.parent(this.cpu_graph);
    }
});

const MemoryIndicator = new Lang.Class({
    Name: 'GnomeStatsPro.MemoryIndicator',
    Extends: Indicator,

    _init: function() {
        this.parent({
            updateInterval: 1000
        });

        this.current_label = new St.Label({style_class:'title_label'});
        this.current_label.set_text("Current:");

        this.current_mem_label = new St.Label({style_class:'description_label'});
        this.current_mem_label.set_text("Total memory usage");
        this.current_mem_value = new St.Label({style_class:'value_label'});

        let layout = this.dropdown.layout_manager;

        GTop.glibtop_get_mem(this.mem);

        this.mem_graph = new HorizontalGraph({autoscale: false, units: 'B', max: this.mem.total});
        this.mem_graph.addDataSet('mem-used', '-mem-used-color');

        layout.attach(this.mem_graph.actor, 0, 0, 2, 1);

        let x = 0, y = 1;
        layout.attach(this.current_label, x+0, y+0, 2, 1);
        layout.attach(this.current_mem_label, x+0, y+1, 1, 1);
        layout.attach(this.current_mem_value, x+1, y+1, 1, 1);
    },

    _initValues: function() {
        this.mem = new GTop.glibtop_mem;

        this.addDataSet('mem-used', '-mem-used-color');
        this.enable();
    },

    _updateValues: function() {
        GTop.glibtop_get_mem(this.mem);

        let mem_used = this.mem.user;
        if (this.mem.slab !== undefined)
            mem_used -= this.mem.slab;
        let t = mem_used / this.mem.total;
        this.addDataPoint('mem-used', t);

        this.mem_graph.addDataPoint('mem-used', mem_used);

        let mem_ttl_text = "%s".format(mem_used.formatMetricPretty('B'));
        this.current_mem_value.set_text(mem_ttl_text);
    },

    showPopup: function() {
        this.parent(this.mem_graph);
    },

    hidePopup: function() {
        this.parent(this.mem_graph);
    }
});

const SwapIndicator = new Lang.Class({
    Name: 'GnomeStatsPro.SwapIndicator',
    Extends: Indicator,

    _init: function() {
        this.parent({
            updateInterval: 2000
        });

        this.current_label = new St.Label({style_class:'title_label'});
        this.current_label.set_text("Current:");

        this.current_swap_label = new St.Label({style_class:'description_label'});
        this.current_swap_label.set_text("Total swap usage");
        this.current_swap_value = new St.Label({style_class:'value_label'});

        let layout = this.dropdown.layout_manager;

        GTop.glibtop_get_swap(this.swap);

        this.swap_graph = new HorizontalGraph({autoscale: false, max: this.swap.total, units: 'B'});
        this.swap_graph.addDataSet('swap-used', '-swap-used-color');

        layout.attach(this.swap_graph.actor, 0, 0, 2, 1);

        let x = 0, y = 1;
        layout.attach(this.current_label, x+0, y+0, 2, 1);
        layout.attach(this.current_swap_label, x+0, y+1, 1, 1);
        layout.attach(this.current_swap_value, x+1, y+1, 1, 1);
    },

    _initValues: function() {
        this.swap = new GTop.glibtop_swap;

        this.addDataSet('swap-used', '-swap-used-color');
        this.enable();
    },

    _updateValues: function() {
        GTop.glibtop_get_swap(this.swap);

        let t = this.swap.used / this.swap.total;
        this.addDataPoint('swap-used', t);

        this.swap_graph.addDataPoint('swap-used', this.swap.used);

        let swap_ttl_text = "%s".format(this.swap.used.formatMetricPretty('B'));
        this.current_swap_value.set_text(swap_ttl_text);

        if (t > 0.5) {
            this.stats['swap-used'].color = "-swap-used-bad-color";
        } else if (t > 0.25) {
            this.stats['swap-used'].color = "-swap-used-warn-color";
        } else {
            this.stats['swap-used'].color = "-swap-used-color";
        }
    },

    showPopup: function() {
        this.parent(this.swap_graph);
    },

    hidePopup: function() {
        this.parent(this.swap_graph);
    }
});

const NetworkIndicator = new Lang.Class({
    Name: 'GnomeStatsPro.NetworkIndicator',
    Extends: Indicator,

    _init: function() {
        this.parent();

        this.current_label = new St.Label({style_class:'title_label'});
        this.current_label.set_text("Current:");

        this.current_in_label = new St.Label({style_class:'description_label'});
        this.current_in_label.set_text("Inbound");
        this.current_in_value = new St.Label({style_class:'value_label'});

        this.current_out_label = new St.Label({style_class:'description_label'});
        this.current_out_label.set_text("Outbound");
        this.current_out_value = new St.Label({style_class:'value_label'});

        this.maximum_label = new St.Label({style_class:'title_label'});
        this.maximum_label.set_text("Maximum (over 2 hours):");

        this.maximum_in_label = new St.Label({style_class:'description_label'});
        this.maximum_in_label.set_text("Inbound");
        this.maximum_in_value = new St.Label({style_class:'value_label'});

        this.maximum_out_label = new St.Label({style_class:'description_label'});
        this.maximum_out_label.set_text("Outbound");
        this.maximum_out_value = new St.Label({style_class:'value_label'});

        let layout = this.dropdown.layout_manager;

        this.net_graph = new HorizontalGraph({units: "b/s"});
        this.net_graph.addDataSet('network-in-used', '-network-in-color');
        this.net_graph.addDataSet('network-out-used', '-network-out-color');

        layout.attach(this.net_graph.actor, 0, 0, 2, 1);

        let x = 0, y = 1;
        layout.attach(this.current_label, x+0, y+0, 2, 1);
        layout.attach(this.current_in_label, x+0, y+1, 1, 1);
        layout.attach(this.current_in_value, x+1, y+1, 1, 1);
        layout.attach(this.current_out_label, x+0, y+2, 1, 1);
        layout.attach(this.current_out_value, x+1, y+2, 1, 1);

        layout.attach(this.maximum_label, x+0, y+3, 2, 1);
        layout.attach(this.maximum_in_label, x+0, y+4, 1, 1);
        layout.attach(this.maximum_in_value, x+1, y+4, 1, 1);
        layout.attach(this.maximum_out_label, x+0, y+5, 1, 1);
        layout.attach(this.maximum_out_value, x+1, y+5, 1, 1);
    },

    showPopup: function() {
        this.parent(this.net_graph);
    },

    hidePopup: function() {
        this.parent(this.net_graph);
    },

    _initValues: function() {
        this._ifs = [];
        this._ifs_speed = [];
        this._last = [0, 0, 0, 0, 0];
        this._usage = [0, 0, 0, 0, 0];
        this._usedp = 0;
        this._previous = [-1, -1, -1, -1, -1];
        this._nmclient = NMClient.Client.new();
        this._update_iface_list();

        this._gtop = new GTop.glibtop_netload;
        this._last_time = 0;
        this._total = 0;

        this.addDataSet('network-in-used', '-network-ok-color');
        this.addDataSet('network-out-used', '-network-ok-color');
        this.enable();
    },

    _update_iface_list: function() {
        if (this._iface_list != undefined && this._ifSignalIds != undefined) {
            for (let j = 0; j < this._ifSignalIds.length; j++) {
                this._iface_list[j].disconnect(this._ifSignalIds[j]);
            }

            this._iface_list = null;
            this._ifSignalIds = null;
        }

        try {
            this._ifs = [];
            this._ifs_speed = [];
            this._ifSignalIds = [];
            let iface_list = this._nmclient.get_devices();
            this._iface_list = iface_list;

            for (let j = 0; j < iface_list.length; j++) {
                this._ifSignalIds[j] = iface_list[j].connect('state-changed', Lang.bind(this, this._update_iface_list));
                if (iface_list[j].state == NetworkManager.DeviceState.ACTIVATED) {
                    this._ifs.push(iface_list[j].get_ip_iface() || iface_list[j].get_iface());
                    this._ifs_speed.push((iface_list[j].get_speed !== undefined ? iface_list[j].get_speed() : -1));
                }
            }
        } catch (e) {
            global.logError("Please install Network Manager GObject Introspection Bindings:" + e);
        }
    },

    _updateValues: function() {
        let accum = [0, 0, 0, 0, 0, 0];
        for (let ifn in this._ifs) {
            GTop.glibtop_get_netload(this._gtop, this._ifs[ifn]);
            accum[0] += this._gtop.bytes_in;
            accum[1] += this._gtop.errors_in;
            accum[2] += this._gtop.bytes_out;
            accum[3] += this._gtop.errors_out;
            accum[4] += this._gtop.collisions;
            accum[5] += this._ifs_speed[ifn];
        }

        let time = GLib.get_monotonic_time() * 0.000001024; // seconds
        let delta = time - this._last_time;
        if (delta > 0) {
            for (let i = 0; i < 5; i++) {
                this._usage[i] = (accum[i] - this._last[i]) / delta;
                this._last[i] = accum[i];
            }

            /* Convert traffic to bits per second */
            // TODO: Create option for bits/bytes shown in graph.
            this._usage[0] *= 8;
            this._usage[2] *= 8;

            /* exponential decay over around 2 hours at 250 interval */
            let firstRun = true;
            for(let i=0; i<5; i++) {
                if (this._previous[i] != -1) {
                    let lambda = 0.9999;
                    this._previous[i] = Math.max(this._usage[i], lambda * this._previous[i]);
                    firstRun = false;
                } else {
                    this._previous[i] = this._usage[i];
                }
            }

            if (firstRun) {
                this._previous[0] = 56 * 1024;
                this._previous[2] = 56 * 1024;
            } else {
                /* Store current traffic values */
                this.addDataPoint('network-in-used', this._usage[0] / this._previous[0]);
                this.addDataPoint('network-out-used', this._usage[2] / this._previous[2]);

                this.net_graph.addDataPoint('network-in-used', this._usage[0]);
                this.net_graph.addDataPoint('network-out-used', this._usage[2]);

                let in_value = "%sb/s".format(this._usage[0].formatMetricPretty());
                this.current_in_value.set_text(in_value);

                let out_value = "%sb/s".format(this._usage[2].formatMetricPretty());
                this.current_out_value.set_text(out_value);

                let max_in_value = "%sb/s".format(this._previous[0].formatMetricPretty());
                this.maximum_in_value.set_text(max_in_value);

                let max_out_value = "%sb/s".format(this._previous[2].formatMetricPretty());
                this.maximum_out_value.set_text(max_out_value);
            }

            /* Report errors for incoming traffic */
            if (this._previous[1] > 0 || this._previous[4] > 0) {
                this.stats['network-in-used'].color = "-network-bad-color";
            } else {
                this.stats['network-in-used'].color = "-network-ok-color";
            }

            /* Report errors for outgoing traffic */
            if (this._previous[3] > 0 || this._previous[4] > 0) {
                this.stats['network-out-used'].color = "-network-bad-color";
            } else {
                this.stats['network-out-used'].color = "-network-ok-color";
            }
        }
        this._last_time = time;
    }
});

const INDICATORS = [CpuIndicator, MemoryIndicator, SwapIndicator, NetworkIndicator];

const Extension = new Lang.Class({
    Name: 'GnomeStatsPro.Extension',

    _init: function() {
	      Convenience.initTranslations();

	      this._showPopupTimeoutId = 0;
	      this._resetHoverTimeoutId = 0;
	      this._popupShowing = false;

          this._createIndicators();
    },

    _createIndicators: function() {
          this._box = new St.BoxLayout({
              style_class: 'gsp-container',
              x_align: Clutter.ActorAlign.START,
              x_expand: true
          });
          this._indicators = [ ];

          for (let i = 0; i < INDICATORS.length; i++) {
              let indicator = new (INDICATORS[i])();

              indicator.actor.connect('notify::hover', Lang.bind(this, function() {
                    this._onHover(indicator);
              }));
              this._box.add_actor(indicator.actor);
              this._indicators.push(indicator);
          }

          this._boxHolder = new St.BoxLayout({
              x_expand: true,
              y_expand: true,
              x_align: Clutter.ActorAlign.START
          });
          this._boxHolder.add_child(this._box);
    },

    enable: function() {
        Main.panel._rightBox.insert_child_at_index(this._boxHolder, 0);
    },

    disable: function() {
        Main.panel._rightBox.remove_child(this._boxHolder);
    },

    destroy: function() {
	    this._indicators.forEach(function(i) { i.destroy(); });

        Main.panel._rightBox.remove_child(this._boxHolder);

        this._boxHolder.remove_child(this._box);

	    this._box.destroy();
	    this._boxHolder.destroy();
    },

    _onHover: function (item) {
        if (item.actor.get_hover()) {
            if (this._showPopupTimeoutId == 0) {
                let timeout = this._popupShowing ? 0 : ITEM_HOVER_TIMEOUT;
                this._showPopupTimeoutId = Mainloop.timeout_add(timeout,
                    Lang.bind(this, function() {
                        this._popupShowing = true;
                        item.showPopup();
                        this._showPopupTimeoutId = 0;
                        return false;
                    }));
                if (this._resetHoverTimeoutId > 0) {
                    Mainloop.source_remove(this._resetHoverTimeoutId);
                    this._resetHoverTimeoutId = 0;
                }
            }
        } else {
            if (this._showPopupTimeoutId > 0)
                Mainloop.source_remove(this._showPopupTimeoutId);
            this._showPopupTimeoutId = 0;
            item.hidePopup();
            if (this._popupShowing) {
                this._resetHoverTimeoutId = Mainloop.timeout_add(ITEM_HOVER_TIMEOUT,
                    Lang.bind(this, function() {
                        this._popupShowing = false;
                        this._resetHoverTimeoutId = 0;
                        return false;
                    }));
            }
        }
    }
});

function init() {
    return new Extension;
}
