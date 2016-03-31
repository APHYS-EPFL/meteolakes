var app = angular.module('lakeViewApp');

app.controller('VelocityCtrl', function($rootScope, $scope, Time, Chart, misc, TemporalData, Map) {
    // ========================================================================
    // PROPERTIES
    // ========================================================================

    var isDataReady = false;
    var c; // coloring function
    var colorLegend = prepareLegend();

    var canvasLayer;
    var map = Map.initMap('velMap');

    Initialize();

    // ========================================================================
    // INIT (I know, code above is also initialization. Deal with it.)
    // ========================================================================
    function Initialize() {
        $rootScope.$on('reloadWeek', function(evt, time) {
            isDataReady = false;

            if($scope.tData && !time.fullReload) {
                // Regular switching of weeks, because the time slider was moving forward.
                $scope.tData.SwitchToData(time.week, time.year);
                // Load the next file if available
                if(time.weeks.indexOf(time.week+1) != -1)
                    $scope.tData.readData(time.week+1, time.year, function() { 
                        dataReady();
                    });
            } else if($scope.tData && time.fullReload) {
                // User changed the date in the lists.
                // Typically means that the required data and the next data are not ready yet.
                $scope.tData.readData(time.week, time.year, function() {
                    $scope.tData.SwitchToData(time.week, time.year);
                    dataReady();
                    prepareGraphics();
                });
                // Load the next file if available
                if(time.weeks.indexOf(time.week+1) != -1)
                    $scope.tData.readData(time.week+1, time.year, function() {});
            } else {
                // First time initialization. Load the required data and the next.
                $scope.tData = new TemporalData(time.folder, 'velocity');
                $scope.tData.readData(time.week, time.year, function() {
                    $scope.tData.SwitchToData(time.week, time.year);

                    dataReady();
                    prepareGraphics();

                    // Load the next file, if available
                    if(time.weeks.indexOf(time.week+1) != -1)
                        $scope.tData.readData(time.week+1, time.year, function() {});
                });
            }
        })

        $scope.Chart = new Chart($scope, Time, '#velPlot', function(d) { return misc.norm(d); })
        $rootScope.$on('reloadChart', function(evt, pointIndex) {
            $scope.Chart.SelectPoint(pointIndex);
        })

        $rootScope.$on('tick', function() {
            animate();
        })
        // start the renderer
        // d3.timer(animate);
    
        $rootScope.$emit('scopeReady');
    }

    // ========================================================================
    // UTILITY FUNCTIONS
    // ========================================================================

    /*
     * Call this method whenever a new bunch of data has been read and is ready
     * to be displayed. 
     * Updates the legend and the axis.
     */
    function dataReady() {
        var minVel = d3.min($scope.tData.Data.map(function(d) { return d3.min(d.values.map(function(v) { return misc.norm(v); })) }));
        var maxVel = d3.max($scope.tData.Data.map(function(d) { return d3.max(d.values.map(function(v) { return misc.norm(v); })) }));

        c = d3.scale.linear().domain([minVel, (minVel+maxVel)/2, maxVel]).range(['blue', 'lime', 'red']);

        // Prepare all thingies
        updateLegend(minVel, maxVel);
        $scope.Chart.UpdateChart($scope.tData.DataTime).Max(maxVel).Min(minVel);

        isDataReady = true;
    }

    /*
     * 
     */
    function prepareGraphics() {
        var velocityData = $scope.tData.map(function(d) {
            var latlng = Map.unproject(L.point(d.x, d.y));
            return {
                lat: latlng.lat,
                lng: latlng.lng,
                values: d.values
            }
        });

        if (canvasLayer) {
            map._map.removeLayer(canvasLayer);
        }

        canvasLayer = L.canvasLayer(velocityData, {colorFunction: c, simplify: true, radius: 30});
        canvasLayer.addTo(map._map);

        animate();
    }

    function prepareLegend() {
        var w = 300, h = 120;
        var key = d3.select('#velLegend').append('svg').attr('id', 'key').attr('width', w).attr('height', h);
        var legend = key.append('defs').append('svg:linearGradient').attr('id', 'gradient').attr('x1', '0%').attr('y1', '100%').attr('x2', '100%').attr('y2', '100%').attr('spreadMethod', 'pad');
        legend.append('stop').attr('offset', '0%').attr('stop-color', 'blue').attr('stop-opacity', 1);
        legend.append('stop').attr('offset', '50%').attr('stop-color', 'lime').attr('stop-opacity', 1);
        legend.append('stop').attr('offset', '100%').attr('stop-color', 'red').attr('stop-opacity', 1);
        key.append('rect').attr('width', w - 100).attr('height', h - 100).style('fill', 'url(#gradient)');
        var color = key.append('g').attr('class', 'x axis').attr('transform', 'translate(0,22)');
        color.append('text').attr('y', 42).attr('dx', '.71em').style('text-anchor', 'start').text('Velocity (m/s)');        
        return color;
    }

    function updateLegend(minVel, maxVel) {
        var x = d3.scale.linear().range([0, 200]).domain([minVel, maxVel]);
        var xAxis = d3.svg.axis().scale(x).ticks(4).orient('bottom');
        colorLegend.call(xAxis);
    }

    /*
     * This function runs under a timer. It is in charge of rendering the canvas.
     * Do not call this directly.
     */
    function animate() {
        if(!isDataReady) return;

        canvasLayer.setStep(Time.tIndex);
        $scope.$apply();

        // render the timeline on the chart
        $scope.Chart.UpdateTimeLine()
    }
});