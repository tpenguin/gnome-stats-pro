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

const Gettext = imports.gettext.domain('gnome-shell-extensions');
const _ = Gettext.gettext;

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

const VerticalIndicator = new Lang.Class({
    Name: 'SystemMonitor.VerticalIndicator',

    options: {
        updateInterval: INDICATOR_UPDATE_INTERVAL,
        barPadding: 1,
        barWidth: 6
    },

    _init: function(options) {
        // process optionals
        this.options = merge_options(this.options, options || {});

        this._barPadding = this.options.barPadding;
        this._barWidth = this.options.barWidth;

        // permit subclass to optionally initialize
        //
        // TODO: Remove this and replace with differring hooks.
        this._initValues();

        // create UI elements
        this.drawing_area = new St.DrawingArea({ reactive: true });
        this.drawing_area.connect('repaint', Lang.bind(this, this._draw));
        this.drawing_area.connect('button-press-event', function() {
            let app = Shell.AppSystem.get_default().lookup_app('gnome-system-monitor.desktop');
            app.open_new_window(-1);
            return true;
        });

        this.actor = new St.Bin({ style_class: "extension-gnomeStatsPro-verticalIndicator-area",
                                  reactive: true, track_hover: true,
                                  x_fill: true, y_fill: true });

        // Create box
        let hbox = new St.BoxLayout({ style_class: 'panel-status-menu-box' });

        // add label, then graph
        this.smallLabel = new St.Label({ style_class: 'extension-gnomeStatsPro-verticalIndicator-smallLabel', y_align: Clutter.ActorAlign.CENTER });
        this.smallLabel.clutter_text.line_wrap = true;
        // this.smallLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD;
        this.smallLabel.set_text(this._smallLabel);

        let labelWidth = this.smallLabel.get_width();
        let y = this.smallLabel.get_height();

        this.actor.add_actor(this.smallLabel);
        this.actor.add_actor(this.drawing_area);

//        let [stageX, stageY] = this.actor.get_transformed_position();

//        this.smallLabel.set_position(stageX, stageY + 40); 

        this.resized = false;

        this._timeout = Mainloop.timeout_add(this.options.updateInterval, Lang.bind(this, function () {
            this._updateValues();
            this.drawing_area.queue_repaint();
            return true;
        }));
    },

    showLabel: function() {
        if (this.label == null)
            return;

        this.label.opacity = 0;
        this.label.show();

        let [stageX, stageY] = this.actor.get_transformed_position();

	      let itemWidth = this.actor.allocation.x2 - this.actor.allocation.x1;
        let itemHeight = this.actor.allocation.y2 - this.actor.allocation.y1;

	      let labelWidth = this.label.width;
        let labelHeight = this.label.height;
        let xOffset = Math.floor((itemWidth - labelWidth) / 2);

        let x = stageX + xOffset;

        let node = this.label.get_theme_node();
        let yOffset = node.get_length('-y-offset');

        let y = stageY + itemHeight + yOffset;

        this.label.set_position(x, y);
        Tweener.addTween(this.label,
                         { opacity: 255,
                           time: ITEM_LABEL_SHOW_TIME,
                           transition: 'easeOutQuad'
                         });
    },

    setLabelText: function(text) {
        if (this.label == null)
            this.label = new St.Label({ style_class: 'extension-systemMonitor-indicator-label'});

        this.label.set_text(text);
        Main.layoutManager.addChrome(this.label);
        this.label.hide();
    },

    hideLabel: function () {
        Tweener.addTween(this.label,
                         { opacity: 0,
                           time: ITEM_LABEL_HIDE_TIME,
                           transition: 'easeOutQuad',
                           onComplete: Lang.bind(this, function() {
                               this.label.hide();
                           })
                         });
    },

    destroy: function() {
        Mainloop.source_remove(this._timeout);

        this.actor.destroy();
	      if (this.label)
	          this.label.destroy();
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
        let [width, height] = area.get_surface_size();
        let cr = area.get_context();
        let themeNode = this.actor.get_theme_node();

        //resize container based on number of bars to chart
        if (this.resized === undefined || !this.resized) {
            this.actor.set_width(this.renderStats.length * (this._barWidth + this._barPadding) + this._barPadding * 2.0 - 1);
            this.resized = true;
        }

        //draw the background grid
        let color = themeNode.get_color(this.gridColor);
        let gridOffset = Math.floor(height / (INDICATOR_NUM_GRID_LINES + 1));
        for (let i = 1; i <= INDICATOR_NUM_GRID_LINES; ++i) {
                cr.moveTo(0, i * gridOffset + .5);
                cr.lineTo(width, i * gridOffset + .5);
        }
        Clutter.cairo_set_source_color(cr, color);
        cr.setLineWidth(1);
        cr.setDash([2,1], 0);
        cr.stroke();

        //draw the foreground
        let self = this;
        function makeVPath(position, values, reverse, nudge) {
            if (nudge == null) {
                nudge = 0;
            }

            cr.moveTo(position * (self._barWidth + self._barPadding) + self._barPadding, (1 - values[0]) * height + nudge);
            cr.lineTo((position + 1) * (self._barWidth + self._barPadding), (1 - values[0]) * height + nudge);
        }

        let renderStats = this.renderStats;

        // Make sure we don't have more sample points than pixels
        renderStats.map(Lang.bind(this, function(k){
            let stat = this.stats[k];
            let keepNumStats = 3; //width + 2;
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

            // Render the background between us and the next level
            makeVPath(i, stat.values, false);

            // If there is a process below us, render the cpu between us and it, otherwise, 
            // render to the bottom of the chart
            //if (i == renderStats.length - 1) {

            // padding 2 width 16
            //
            // 0th: 2,y 18,y
            // 1th: 20,y 36,y
            // 2th: 38,y 54,y
            cr.lineTo((i + 1) * (this._barWidth + this._barPadding), height);
            cr.lineTo(i * (this._barWidth + this._barPadding) + this._barPadding, height);
            cr.closePath();
            //} else {
            //    let nextStat = this.stats[renderStats[i+1]];
            //    makePath(nextStat.values, true);
                //let nextStat = this.stats[renderStats[i+1]];
                //makePath(i+1, nextStat.values, true);
            //}
            //cr.closePath()
            Clutter.cairo_set_source_color(cr, color);
            cr.fill();

            // Render the outline of this level
            makeVPath(i, stat.values, false, .5);
            Clutter.cairo_set_source_color(cr, outlineColor);
            cr.setLineWidth(1.0);
            cr.setDash([], 0);
            cr.stroke();
        }

        // Render the label

    }
});

const Indicator = new Lang.Class({
    Name: 'SystemMonitor.Indicator',

    options: {
        updateInterval: INDICATOR_UPDATE_INTERVAL
    },

    _init: function(options) {
        // process optionals
        this.options = merge_options(this.options, options || {});

        // permit subclass to optionally initialize
        //
        // TODO: Remove this and replace with differring hooks.
        this._initValues();

        // create GUI elements
        this.drawing_area = new St.DrawingArea({ reactive: true });
        this.drawing_area.connect('repaint', Lang.bind(this, this._draw));
        this.drawing_area.connect('button-press-event', function() {
            let app = Shell.AppSystem.get_default().lookup_app('gnome-system-monitor.desktop');
            app.open_new_window(-1);
            return true;
        });

        this.actor = new St.Bin({ style_class: "extension-systemMonitor-indicator-area",
                                  reactive: true, track_hover: true,
				  x_fill: true, y_fill: true });
        this.actor.add_actor(this.drawing_area);

        // schedule UI stats value updates on us
        this._timeout = Mainloop.timeout_add(this.options.updateInterval, Lang.bind(this, function () {
            this._updateValues();
            this.drawing_area.queue_repaint();
            return true;
        }));
    },

    showLabel: function() {
        if (this.label == null)
            return;

        this.label.opacity = 0;
        this.label.show();

        let [stageX, stageY] = this.actor.get_transformed_position();

	      let itemWidth = this.actor.allocation.x2 - this.actor.allocation.x1;
        let itemHeight = this.actor.allocation.y2 - this.actor.allocation.y1;

	      let labelWidth = this.label.width;
        let labelHeight = this.label.height;
        let xOffset = Math.floor((itemWidth - labelWidth) / 2);

        let x = stageX + xOffset;

        let node = this.label.get_theme_node();
        let yOffset = node.get_length('-y-offset');

        let y = stageY + this.label.get_height() + yOffset - 6;

        this.label.set_position(x, y);
        Tweener.addTween(this.label,
                         { opacity: 255,
                           time: ITEM_LABEL_SHOW_TIME,
                           transition: 'easeOutQuad',
                         });
    },

    setLabelText: function(text) {
        if (this.label == null)
            this.label = new St.Label({ style_class: 'extension-systemMonitor-indicator-label'});

        this.label.set_text(text);
        Main.layoutManager.addChrome(this.label);
        this.label.hide();
    },

    hideLabel: function () {
        Tweener.addTween(this.label,
                         { opacity: 0,
                           time: ITEM_LABEL_HIDE_TIME,
                           transition: 'easeOutQuad',
                           onComplete: Lang.bind(this, function() {
                               this.label.hide();
                           })
                         });
    },

    destroy: function() {
        Mainloop.source_remove(this._timeout);

        this.actor.destroy();
	      if (this.label)
	          this.label.destroy();
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
        let [width, height] = area.get_surface_size();
        let themeNode = this.actor.get_theme_node();
        let cr = area.get_context();

        //draw the background grid
        let color = themeNode.get_color(this.gridColor);
        let gridOffset = Math.floor(height / (INDICATOR_NUM_GRID_LINES + 1));
        for (let i = 1; i <= INDICATOR_NUM_GRID_LINES; ++i) {
                cr.moveTo(0, i * gridOffset + .5);
                cr.lineTo(width, i * gridOffset + .5);
        }
        Clutter.cairo_set_source_color(cr, color);
        cr.setLineWidth(1);
        cr.setDash([2,1], 0);
        cr.stroke();

        //draw the foreground

        function makePath(values, reverse, nudge) {
            if (nudge == null) {
                nudge = 0;
            }
            //if we are going in reverse, we are completing the bottom of a chart, so use lineTo
            if (reverse) {
                cr.lineTo(values.length - 1, (1 - values[values.length - 1]) * height + nudge);
                for (let k = values.length - 2; k >= 0; --k) {
                    cr.lineTo(k, (1 - values[k]) * height + nudge);
                }
            } else {
                cr.moveTo(0, (1 - values[0]) * height + nudge);
                for (let k = 1; k < values.length; ++k) {
                    cr.lineTo(k, (1 - values[k]) * height + nudge);
                }
            }
        }

        let renderStats = this.renderStats;

        // Make sure we don't have more sample points than pixels
        renderStats.map(Lang.bind(this, function(k){
            let stat = this.stats[k];
            let new_width = width + 2;
            if (stat.values.length > new_width) {
                stat.values = stat.values.slice(stat.values.length - new_width, stat.values.length);
            }
        }));

        for (let i = 0; i < renderStats.length; ++i) {
            let stat = this.stats[renderStats[i]];
            // We outline at full opacity and fill with 40% opacity
            let outlineColor = themeNode.get_color(stat.color);
            let color = new Clutter.Color(outlineColor);
            color.alpha = color.alpha * .4;

            // Render the background between us and the next level
            makePath(stat.values, false);
            // If there is a process below us, render the cpu between us and it, otherwise, 
            // render to the bottom of the chart
            if (i == renderStats.length - 1) {
                cr.lineTo(stat.values.length - 1, height);
                cr.lineTo(0, height);
                cr.closePath();
            } else {
                let nextStat = this.stats[renderStats[i+1]];
                makePath(nextStat.values, true);
            }
            cr.closePath()
            Clutter.cairo_set_source_color(cr, color);
            cr.fill();

            // Render the outline of this level
            makePath(stat.values, false, .5);
            Clutter.cairo_set_source_color(cr, outlineColor);
            cr.setLineWidth(1.0);
            cr.setDash([], 0);
            cr.stroke();
        }
    }
});

const CpuIndicator = new Lang.Class({
    Name: 'SystemMonitor.CpuIndicator',
    Extends: VerticalIndicator,

    _init: function() {
        this._smallLabel = "c";

        this.parent({
            updateInterval: 250,
            decay: 0.8
        });

        // Populate statistics available keys
        this.renderStats = [];
        for (var i=0; i<this.ncpu; ++i) {
            let key = 'cpu_' + i;
            this.renderStats.push(key);
        }

        // Configure grid coloring
        this.gridColor = '-grid-color';

        // Set hover label text
    	  this.setLabelText(_("CPU"));
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
        this.stats = {};
        for (let cpu = 0; cpu < this.ncpu; cpu++) {
            let key = 'cpu_' + cpu;

            this.stats[key] = {color: '-cpu-color', values: []};
            this._pcpu[cpu] = 0;
        }
    },

    _updateValues: function() {
        // Query current iteration CPU statistics
        let cpu = new GTop.glibtop_cpu;
        GTop.glibtop_get_cpu(cpu);

        // Collect per-CPU statistics
        for (var i=0; i<this.ncpu; ++i) {
            let total = cpu.xcpu_total[i] - this._prev.xcpu_total[i];
            let idle = cpu.xcpu_idle[i] - this._prev.xcpu_idle[i];
            let key = 'cpu_' + i;

            let reading = 1.0 - idle / total;

            let decay_value = Math.min(this._pcpu[i] * this.options.decay, 0.999999999);
            let value = Math.max(reading, decay_value);
            this._pcpu[i] = value;

            this.stats[key].values.push(value);
        }

        // Store this iteration for next calculation run
        this._prev = cpu;
    }
});

const MemoryIndicator = new Lang.Class({
    Name: 'SystemMonitor.MemoryIndicator',
    Extends: VerticalIndicator,

    _init: function() {
        this._smallLabel = "m";

        this.parent({
            updateInterval: 1000
        });

        this.gridColor = '-grid-color';

        this.renderStats = [ 'mem-used' ];

    	  this.setLabelText(_("Memory"));
    },

    _initValues: function() {
        this.mem = new GTop.glibtop_mem;
        this.stats = {
                        'mem-used': { color: "-mem-used-color", values: [] }
                     };
    },

    _updateValues: function() {
        GTop.glibtop_get_mem(this.mem);

        let t = (this.mem.free + this.mem.shared + this.mem.buffer + this.mem.locked + this.mem.cached) / this.mem.total;
        this.stats['mem-used'].values.push(t);
    }
});

const SwapIndicator = new Lang.Class({
    Name: 'SystemMonitor.SwapIndicator',
    Extends: VerticalIndicator,

    _init: function() {
        this._smallLabel = "s";

        this.parent({
            updateInterval: 2000
        });

        this.gridColor = '-grid-color';

        this.renderStats = [ 'swap-used' ];

    	  this.setLabelText(_("Swap Memory"));
    },

    _initValues: function() {
        this.mem = new GTop.glibtop_swap;
        this.stats = {
                        'swap-used': { color: "-mem-used-color", values: [] }
                     };
    },

    _updateValues: function() {
        GTop.glibtop_get_swap(this.mem);

        let t = this.mem.used / this.mem.total;
        this.stats['swap-used'].values.push(t);

    	//this.setLabelText(_(this._bytes_to_mega(this.mem.used) + " MB of swap memory in use.\n\n" + this._bytes_to_mega(this.mem.total) + " MB of swap available."));

        if (t > 0.5) {
            this.stats['swap-used'].color = "-mem-used-bad-color";
        } else if (t > 0.25) {
            this.stats['swap-used'].color = "-mem-used-warn-color";
        } else {
            this.stats['swap-used'].color = "-mem-used-color";
        }
    },

    _bytes_to_mega: function(bytes) {
        return Math.round(bytes / 1024 / 1024);
    }
});

const NetworkIndicator = new Lang.Class({
    Name: 'SystemMonitor.NetworkIndicator',
    Extends: VerticalIndicator,

    _init: function() {
        this._smallLabel = "n";

        this.parent();

        this.gridColor = '-grid-color';

        this.renderStats = [ 'network-in-used', 'network-out-used' ];

    	  this.setLabelText(_("Network (in,out)"));

        this._initValues();
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

        this.stats = {
            'network-in-used': { color: "-network-ok-color", values: [] },
            'network-out-used': { color: "-network-ok-color", values: [] }
        };

        this.stats['network-in-used'].values.push(0);
        this.stats['network-out-used'].values.push(0);
    },

    _update_iface_list: function() {
        try {
            this._ifs = [];
            this._ifs_speed = [];
            let iface_list = this._nmclient.get_devices();
            for (let j = 0; j < iface_list.length; j++) {
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
                this.stats['network-in-used'].values.push(this._usage[0] / this._previous[0]);
                this.stats['network-out-used'].values.push(this._usage[2] / this._previous[2]);

                if (this.label !== null) {
                    let text = "Network\n\nCurrent:\n%sbps in\n%sbps out\n\nDecayed Maximum:\n%sbps in\n%sbps out".format(this.formatNumber(this._usage[0]), this.formatNumber(this._usage[2]), this.formatNumber(this._previous[0]), this.formatNumber(this._previous[2]));
                    this.label.set_text(text);
                }
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
    },

    formatNumber: function(v) {
        let m = v / (1024 * 1024);
        let f = "";
        if (v > 1024 * 1024) {
            v /= 1024 * 1024;
            f = "M";
        } else if (v > 1024) {
            v /= 1024;
            f = "K";
        }
        return "%0.2f %s".format(v, f);
    }
});

const INDICATORS = [CpuIndicator, MemoryIndicator, SwapIndicator, NetworkIndicator];

const Extension = new Lang.Class({
    Name: 'SystemMonitor.Extension',

    _init: function() {
	Convenience.initTranslations();

	this._showLabelTimeoutId = 0;
	this._resetHoverTimeoutId = 0;
	this._labelShowing = false;
    },

    enable: function() {
	this._box = new St.BoxLayout({ style_class: 'extension-systemMonitor-container',
				       x_align: Clutter.ActorAlign.START,
				       x_expand: true });
	this._indicators = [ ];

	for (let i = 0; i < INDICATORS.length; i++) {
	    let indicator = new (INDICATORS[i])();

            indicator.actor.connect('notify::hover', Lang.bind(this, function() {
		this._onHover(indicator);
	    }));
	    this._box.add_actor(indicator.actor);
	    this._indicators.push(indicator);
	}

	this._boxHolder = new St.BoxLayout({ x_expand: true,
					     y_expand: true,
					     x_align: Clutter.ActorAlign.START,
					   });
	//let menuButton = Main.messageTray._messageTrayMenuButton.actor;
	//Main.messageTray.actor.remove_child(menuButton);
	//Main.messageTray.actor.add_child(this._boxHolder);

	this._boxHolder.add_child(this._box);
    //this._boxHolder.add_child(menuButton);
    Main.panel._rightBox.insert_child_at_index(this._boxHolder, 0);
    },

    disable: function() {
	this._indicators.forEach(function(i) { i.destroy(); });

	//let menuButton = Main.messageTray._messageTrayMenuButton.actor;
	//this._boxHolder.remove_child(menuButton);
    //Main.messageTray.actor.add_child(menuButton);
    Main.panel._rightBox.remove_child(this._boxHolder);

    this._boxHolder.remove_child(this._box);

	this._box.destroy();
	this._boxHolder.destroy();
    },

    _onHover: function (item) {
        if (item.actor.get_hover()) {
            if (this._showLabelTimeoutId == 0) {
                let timeout = this._labelShowing ? 0 : ITEM_HOVER_TIMEOUT;
                this._showLabelTimeoutId = Mainloop.timeout_add(timeout,
                    Lang.bind(this, function() {
                        this._labelShowing = true;
                        item.showLabel();
                        return false;
                    }));
                if (this._resetHoverTimeoutId > 0) {
                    Mainloop.source_remove(this._resetHoverTimeoutId);
                    this._resetHoverTimeoutId = 0;
                }
            }
        } else {
            if (this._showLabelTimeoutId > 0)
                Mainloop.source_remove(this._showLabelTimeoutId);
            this._showLabelTimeoutId = 0;
            item.hideLabel();
            if (this._labelShowing) {
                this._resetHoverTimeoutId = Mainloop.timeout_add(ITEM_HOVER_TIMEOUT,
                    Lang.bind(this, function() {
                        this._labelShowing = false;
                        return false;
                    }));
            }
        }
    },
});

function init() {
    return new Extension();
}
