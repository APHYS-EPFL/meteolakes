'use strict';

angular.module('meteolakesApp').component('lakeView', {
    templateUrl: 'app/lake-view/lake-view.template.html',
    transclude: true, // Needed for the lake-icon directive
    bindings: {
        var: '@', // Variable to be plotted (= name of subfolder in CSV data folder)
        legendVar: '@', // Name of Variable, in human-readable format with unit
        type: '@',  // Type of plotted data, 'value' or 'vector'
        hasTransects: '@', // Whether or not there is transect data available
        lakeId: '<',
        maxExtentValue: '<',
        maxExtentForceValue: '<',
        minExtentValue: '<',
        minExtentForceValue: '<'
    },
    controller: function($scope, $q, Time, TemporalData, NearestNeighbor, Util, MapHelpers) {
        var colorFunctions = [];
        var nearestNeighbor = null;
        var animationHandlers = [];
        var dataSources = ['surface'];
        var me = this;
        var icons = [];
        var particles = {};
        var hashes = [];
        var lastClick = 0;
        var PARTICLE_CLICK_DELTA_MS = 50;
        var leafletMap = null;
        var currentTindex = Time.tIndex;
        var saveParticlesForNextWeek = false;

        me.tab = 'surface';
        me.dataReady = false;
        me.timeSelection = null;
        me.vectorLabel = 'Depth Averaged';
        me.valueLabel = 'Surface';

        if (me.type === 'value') {
            me.surfaceData = new TemporalData(me.var, 0.03);
            me.legendColors = ['blue', 'cyan', 'lime', 'yellow', 'red'];
            if (me.hasTransects === 'true') {
                me.sliceXZData = new TemporalData(me.var, 0, 'slice_xz');
                me.sliceYZData = new TemporalData(me.var, 0, 'slice_yz');
                dataSources = ['surface', 'sliceXZ', 'sliceYZ'];
            } else {
                me.sliceXZData = null; me.sliceYZData = null;
            }
        } else if (me.type === 'vector') {
            me.surfaceData = new TemporalData(me.var);
            me.surfaceData.setValueAccessor(Util.norm);
            me.particlesData = new TemporalData(me.var);
            me.particlesData.setValueAccessor(Util.norm);
            me.legendColors = ['blue', 'lime', 'red'];
            dataSources = ['surface', 'particles'];
        } else if (me.type === 'valueWAQoxygen') {
            me.surfaceData = new TemporalData(me.var, 0.03);
            me.legendColors = ['black', 'red', 'yellow', 'cyan', 'blue'];
            if (me.hasTransects === 'true') {
                me.sliceXZData = new TemporalData(me.var, 0, 'slice_xz');
                me.sliceYZData = new TemporalData(me.var, 0, 'slice_yz');
                dataSources = ['surface', 'sliceXZ', 'sliceYZ'];
            } else {
                me.sliceXZData = null; me.sliceYZData = null;
            }
        } else if (me.type === 'valueWAQchlfa') {
            me.surfaceData = new TemporalData(me.var, 0.03);
            me.legendColors = ['blue', 'cyan', 'lightgreen', 'green'];
            if (me.hasTransects === 'true') {
                me.sliceXZData = new TemporalData(me.var, 0, 'slice_xz');
                me.sliceYZData = new TemporalData(me.var, 0, 'slice_yz');
                dataSources = ['surface', 'sliceXZ', 'sliceYZ'];
            } else {
                me.sliceXZData = null; me.sliceYZData = null;
            }
        }

        $scope.$emit('registerClient'); // Tell the time controller we're here

        $scope.$on('updateTimeSelection', function(evt, selection) {
            colorFunctions = {};
            me.dataReady = false;
            me.timeSelection = selection;
            if (selection.depth !== null) {
                me.vectorLabel = 'Layer ' + Math.abs(selection.depth) + ' m';
                me.valueLabel = 'Layer ' + Math.abs(selection.depth) + ' m';
            } else {
                me.vectorLabel = 'Depth Averaged';
                me.valueLabel = 'Surface';
            }

            me.closeChart();
            if (!saveParticlesForNextWeek) {
                hashes = [];
                particles = [];
            } else {
                hashes.forEach(function(hash) {
                    var tmpParticle = particles[hash][particles[hash].length - 1];
                    particles[hash] = [];
                    particles[hash][0] = tmpParticle;
                    updateParticle(particles[hash]);
                });
                saveParticlesForNextWeek = false;
            }
            // Load metadata of all tabs to update tab availabilities
            dataSources.forEach(function(source) {
                me[source + 'Data'].setTimeSelection(selection).then(function() {
                    if (source === me.tab) {
                        // Start reading data of current tab once metadata is ready
                        loadCurrentData();
                    }
                });
            });
        });

        $scope.$on('timerPaused', function() {
            saveParticlesForNextWeek = false;
        });

        $scope.$on('tick', animate);
        $scope.$watch('$ctrl.chartPoint', updateChart);
        $scope.$on('mapLoaded', function(evt, map) {
            leafletMap = map;
        });
        $scope.$on('dataReady', function() {
            hashes.forEach(function(hash) {
                updateParticle(particles[hash]);
            });
        });

        me.addAnimationHandler = function(handler) {
            animationHandlers.push(handler);
        };

        me.closeChart = function() {
            me.chartPoint = null;
        };

        me.initMap = function(map) {
            icons.forEach(function(icon) {
                var leafletIcon = L.icon({
                    iconUrl: icon.src,
                    iconSize: [icon.width, icon.height],
                    iconAnchor: [icon.anchorLeft, icon.anchorTop],
                    popupAnchor: [icon.popupLeft, icon.popupTop]
                });
                L.marker({ lat: icon.lat, lng: icon.lng }, { icon: leafletIcon })
                .addTo(map).bindPopup(icon.popupText);
            });
        };

        // Called by child lake-icon elements
        me.addIcon = function(icon) {
            icons.push(icon);
        };

        me.drawOverlay = function(data, options) {
            if (!me.dataReady) { return new PIXI.Graphics(); }

            if (me.type === 'vector') {
                return drawVectorOverlay(data, options);
            }
            return drawValueOverlay(data, options);
        };

        function drawValueOverlay(data, options) {
            var colorFunction = colorFunctions[options.dataSource];
            var size = options.size;
            var graphics = new PIXI.Graphics();

            if (!colorFunction || me.tab !== options.dataSource) {
                return graphics;
            }

            if (options.background) {
                var origin = options.project([0, 0]);
                graphics.beginFill(0x4682B4);
                graphics.drawRect(0, 0, size.x, origin.y);
                graphics.endFill();
                graphics.beginFill(0x896E53);
                graphics.drawRect(0, origin.y, size.x, size.y);
                graphics.endFill();
            }

            var bounds = new L.Bounds(L.point([0, 0]), size);

            // Loop over the grid to draw a quadrilateral (polygon with 4 vertices)
            // colored according to the plot variable for every point except
            // for the last row/column. The coordinates of neighboring points
            // from the next row/column are used to define the quadrilateral, which
            // is why the last row/column cannot be used.
            for (var i = 0; i < data.length - 1; i++) {
                var row = data[i];
                var nextRow = data[i + 1];
                for (var j = 0; j < row.length - 1; j++) {
                    // The 4 points of the quadrilateral
                    var points = [row[j], row[j + 1], nextRow[j], nextRow[j + 1]];

                    // Check if all points are defined
                    if (points.every(function(p) { return p; })) {
                        // Check if any point is within bounds
                        if (points.some(function(p) { return bounds.contains(p.p); })) {
                            var color = colorFunction(row[j].values[Time.tIndex]);

                            var p00 = points[0].p;
                            var p01 = points[1].p;
                            var p10 = points[2].p;
                            var p11 = points[3].p;

                            graphics.beginFill(+color.replace('#', '0x'));
                            graphics.moveTo(p00.x, p00.y);
                            graphics.lineTo(p01.x, p01.y);
                            graphics.lineTo(p11.x, p11.y);
                            graphics.lineTo(p10.x, p10.y);
                            graphics.endFill();
                        }
                    }
                }
            }

            return graphics;
        }

        function drawVectorOverlay(data, options) {
            var colorFunction = colorFunctions[options.dataSource];
            var size = options.size;
            var r = 30;
            var bounds = new L.Bounds(L.point([-r, -r]), size.add([r, r]));
            var cell;
            var cellSize = r / 2;
            var grid = [];
            var len;
            var len2;
            var d;
            var i;
            var j;
            var x;
            var y;
            var maxNorm = 0;


            for (i = 0, len = data.length; i < len; i++) {
                var row = data[i];
                for (j = 0; j < row.length; j++) {
                    d = row[j];
                    if (d) {
                        if (bounds.contains(d.p)) {
                            x = Math.floor((d.p.x) / cellSize) + 2;
                            y = Math.floor((d.p.y) / cellSize) + 2;

                            var value = d.values[Time.tIndex];
                            // compute maxNorm
                            for (var m = 0; m < d.values.length; m++) {
                                var norm = Math.sqrt(d.values[m][0] * d.values[m][0] + d.values[m][1] * d.values[m][1]);
                                if (norm > maxNorm) { maxNorm = norm; }
                            }

                            grid[y] = grid[y] || [];
                            cell = grid[y][x];

                            if (!cell) {
                                grid[y][x] = [d.p.x, d.p.y, value[0], value[1], 1];
                            } else {
                                cell[0] += d.p.x;
                                cell[1] += d.p.y;
                                cell[2] += value[0];
                                cell[3] += value[1];
                                cell[4]++;
                            }
                        }
                    }
                }
            }

            var graphics = new PIXI.Graphics();
            for (i = 0, len = grid.length; i < len; i++) {
                if (grid[i]) {
                    for (j = 0, len2 = grid[i].length; j < len2; j++) {
                        cell = grid[i][j];
                        if (cell) {
                            x = cell[0] / cell[4];
                            y = cell[1] / cell[4];
                            var dx = cell[2] / cell[4];
                            var dy = cell[3] / cell[4];
                            var color = colorFunction([dx, dy]);

                            // TODO use max velocity to determine scale factor
                            drawArrow(x, y, dx, -dy, color, graphics, maxNorm);
                        }
                    }
                }
            }

            graphics.lineStyle(me.global.particleLineThickness, me.global.particleLineColor);
            hashes.forEach(function(hash) {
                var particle = particles[hash][Time.tIndex];
                if (particle) {
                    drawParticle(particle, graphics);
                }
            });

            return graphics;
        }

        me.addParticles = function(point) {
            var diff = Date.now() - lastClick;
            lastClick = Date.now();
            if (diff > PARTICLE_CLICK_DELTA_MS) {
                for (var i = 0; i < me.global.particleAddedOnClick; i++) {
                    var x = random(
                        point.x - me.options.insertRadius,
                        point.x + me.options.insertRadius);
                    var y = random(
                        point.y - me.options.insertRadius,
                        point.y + me.options.insertRadius);

                    var hash = guid();
                    hashes.push(hash);
                    particles[hash] = [];
                    particles[hash][Time.tIndex] = { x: x, y: y };
                    updateParticle(particles[hash]);
                }
                $scope.$broadcast('particleAdded');
            }
        };

        function guid() {
            function s4() {
                return Math.floor((1 + Math.random()) * 0x10000)
                .toString(16)
                .substring(1);
            }
            return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
                s4() + '-' + s4() + s4() + s4();
        }

        function random(min, max) {
            return Math.floor(Math.random() * (max - min)) + min;
        }

        function drawParticle(particle, graphics) {
            var point = particle;
            var neighbor = nearestNeighbor.query(point);
            if (Math.abs(neighbor.x - point.x) > me.options.maxDistToNeighbour ||
                Math.abs(neighbor.y - point.y) > me.options.maxDistToNeighbour) {
                point = neighbor;
            }
            var mapPoint = dataPointToMapPoint(point);
            graphics.beginFill(me.global.particleFillColor);
            graphics.drawCircle(mapPoint.x, mapPoint.y, me.global.particleSize);
            graphics.endFill();
        }

        function dataPointToMapPoint(point) {
            var latlng = MapHelpers.unproject(point);
            return leafletMap.latLngToContainerPoint(latlng);
        }

        function drawArrow(x, y, dx, dy, color, graphics, maxNorm) {
            var extent = Math.sqrt(dx * dx + dy * dy);
            if (extent > 0.001) {
                var fromx = x;
                var fromy = y;
                var scaledDx = dx * scaling(extent, maxNorm);
                var scaledDy = dy * scaling(extent, maxNorm);
                var tox = x + scaledDx;
                var toy = y + scaledDy;

                var newNorm = Math.sqrt(scaledDx * scaledDx + scaledDy * scaledDy);
                var headlen = newNorm / 5 > 2 ? newNorm / 5 : 2;   // length of head in pixels
                var angle = Math.atan2(scaledDy, scaledDx);

                graphics.lineStyle(1 + 5 * extent, +color.replace('#', '0x'));
                graphics.moveTo(fromx, fromy);
                graphics.lineTo(tox, toy);
                graphics.lineTo(tox - headlen * Math.cos(angle - Math.PI / 6),
                    toy - headlen * Math.sin(angle - Math.PI / 6));
                graphics.moveTo(tox, toy);
                graphics.lineTo(tox - headlen * Math.cos(angle + Math.PI / 6),
                    toy - headlen * Math.sin(angle + Math.PI / 6));
            }
        }

        function scaling(norm, maxNorm) {
            var maxLength = 30;
            var minLength = 5;
            var result = (-1 / (norm / maxNorm + 1) + 1) * maxLength * 2;
            if (result < minLength) {
                return minLength / norm;
            }
            return result / norm;
        }

        me.mapClicked = function(point) {
            me.chartPoint = nearestNeighbor.query(point);
        };

        me.sliceClicked = function(point) {
            me.chartPoint = point;
        };

        me.setTab = function(tab) {
            me.closeChart();
            particles = {};
            hashes = [];
            me.tab = tab;
            $scope.$emit('tabChanged');
            me.dataReady = false;
            loadCurrentData();
        };

        function loadCurrentData() {
            var source = me.tab;
            if (me.tab === 'particles') {
                source = 'surface';
            }
            var temporalData = me[source + 'Data'];
            if (!temporalData.available && source !== 'surface') {
                me.setTab('surface');
            } else {
                var dataLoaded = 0;
                temporalData.getLakeOptions().then(function(options) {
                    me.options = options;
                    dataLoaded = doDataLoaded(dataLoaded, temporalData);
                });
                temporalData.getGlobalOptions().then(function(options) {
                    me.global = options;
                    dataLoaded = doDataLoaded(dataLoaded, temporalData);
                });
                temporalData.readData().then(function() {
                    var diff = 0;
                    var extent = temporalData.scaleExtent;
                    if (me.minExtentValue && extent[0] < me.minExtentValue) {
                        diff = me.minExtentValue - extent[0];
                        extent[0] = me.minExtentValue;
                        if (extent[1] < me.minExtentValue) {
                            /* If the max boundary is lower than the new min value,
                             * we set it to a new value with the same difference as before.
                             */
                            extent[1] = me.minExtentValue + diff;
                        }
                    }
                    if (me.minExtentForceValue) {
                        diff = me.minExtentForceValue - extent[0];
                        extent[0] = me.minExtentForceValue;
                        if (extent[1] < me.minExtentForceValue) {
                            /* If the max boundary is lower than the new min value,
                             * we set it to a new value with the same difference as before.
                             */
                            extent[1] = me.minExtentForceValue + diff;
                        }
                    }
                    if (me.maxExtentValue && extent[1] > me.maxExtentValue) {
                        extent[1] = me.maxExtentValue;
                    }
                    if (me.maxExtentForceValue) {
                        extent[1] = me.maxExtentForceValue;
                    }
                    colorFunctions[source] = generateColorFunction(extent);
                    if (source === 'surface') {
                        nearestNeighbor = NearestNeighbor(me.surfaceData);
                    }
                    me[source + 'Extent'] = extent; // This one is used for the color legend
                    dataLoaded = doDataLoaded(dataLoaded, temporalData);
                });
            }
        }

        function doDataLoaded(dataLoaded, temporalData) {
            dataLoaded++;
            if (dataLoaded === 3) {
                me.dataReady = true;
                $scope.$emit('dataReady', temporalData.timeSteps);
            }
            return dataLoaded;
        }

        function generateColorFunction(extent) {
            var minValue = extent[0];
            var maxValue = extent[1];

            var domain = me.legendColors.map(function(d, i) {
                return minValue + i / (me.legendColors.length - 1) * (maxValue - minValue);
            });
            if (me.type === 'vector') {
                return function(vec) {
                    var fn = d3.scale.linear().domain(domain).range(me.legendColors);
                    return fn(Util.norm(vec));
                };
            }
            return d3.scale.linear().domain(domain).range(me.legendColors);
        }

        function updateChart(point) {
            if (point) {
                var temporalData = me[me.tab + 'Data'];
                var data = temporalData.Data[point.i][point.j];

                if (me.timeSelection.needNetcdf) {
                    temporalData.getDataAtPoint(data).then(function(plotData) {
                        me.chartData = {
                            x: data.x,
                            y: data.y,
                            z: me.tab === 'surface' ? me.timeSelection.depth : data.z,
                            data: plotData
                        };
                    });
                } else {
                    var values = data.values.map(Util.norm);
                    me.chartData = {
                        x: data.x,
                        y: data.y,
                        data: temporalData.withTimeSteps(values)
                    };
                }
            } else {
                me.chartData = null;
            }
        }

        function particleInOutlets(particle) {
            return me.options.outlets.some(function(outlet) {
                var distance =
                Math.sqrt(
                    Math.pow(particle.x - outlet.x, 2) +
                    Math.pow(particle.y - outlet.y, 2));
                return distance < outlet.r;
            });
        }

        function updateParticleOneStep(particleList, tIndex) {
            var particle = particleList[tIndex];
            if (particle && !particleInOutlets(particle)) {
                var temporalData = me.surfaceData;
                var point = nearestNeighbor.query(particle);
                var data = temporalData.Data[point.i][point.j];
                var value = data.values[tIndex];
                var x = particle.x + value[0] * 3600 * 3;
                var y = particle.y + value[1] * 3600 * 3;
                particleList[parseInt(tIndex, 10) + 1] = { x: x, y: y };
            }
        }

        function updateParticle(particleList) {
            for (var tIndex = Time.tIndex; tIndex < Time.nSteps; tIndex++) {
                updateParticleOneStep(particleList, tIndex);
            }
        }

        function animate() {
            animationHandlers.forEach(function(handler) {
                handler(Time.tIndex);
            });
            if (me.tab === 'particles') {
                if (currentTindex === Time.nSteps - 1) {
                    saveParticlesForNextWeek = true;
                    $scope.$emit('moveToNextWeek');
                }
            }
            currentTindex = Time.tIndex % Time.nSteps;
        }
    }
});
