/* <copyright>
Copyright (c) 2012, Motorola Mobility LLC.
All Rights Reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice,
  this list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of Motorola Mobility LLC nor the names of its
  contributors may be used to endorse or promote products derived from this
  software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
</copyright> */
/**
    @module "montage/ui/view.reel"
    @requires montage
    @requires montage/ui/component
*/

require("runtime/dependencies/gl-matrix");
var Montage = require("montage").Montage;
var Component = require("montage/ui/component").Component;
var GLSLProgram = require("runtime/glsl-program").GLSLProgram;
var ResourceManager = require("runtime/helpers/resource-manager").ResourceManager;
var glTFScene = require("runtime/glTF-scene").glTFScene;
var glTFNode = require("runtime/glTF-node").glTFNode;
var Scene = require("runtime/scene").Scene;
var Node = require("runtime/node").Node;
var SceneRenderer = require("runtime/scene-renderer").SceneRenderer;
var glTFMaterial = require("runtime/glTF-material").glTFMaterial;
var Utilities = require("runtime/utilities").Utilities;
var dom = require("montage/core/dom");
var Point = require("montage/core/geometry/point").Point;
var TranslateComposer = require("montage/composer/translate-composer").TranslateComposer;
var BuiltInAssets = require("runtime/builtin-assets").BuiltInAssets;
var WebGLRenderer = require("runtime/webgl-renderer").WebGLRenderer;
var URL = require("montage/core/url");
var Projection = require("runtime/projection").Projection;
var Camera = require("runtime/camera").Camera;
var BBox = require("runtime/utilities").BBox;
var SceneHelper = require("runtime/scene-helper").SceneHelper;
var CameraController = require("controllers/camera-controller").CameraController;

/**
    Description TODO
    @class module:"montage/ui/view.reel".view
    @extends module:montage/ui/component.Component
*/
exports.View = Component.specialize( {

    _firstFrameDidRender: { value: false, writable: true },

    _sceneResourcesLoaded: { value: false, writable: true },

    _scene: { value: null, writable: true },

    allowsProgressiveSceneLoading: {
        value:false, writable:true
    },

    sceneWillChange: {
        value: function(value) {
            this.viewPointModifierMatrix = mat4.identity();
            this.interpolatingViewPoint = null;
            this._firstFrameDidRender = false;

            if (this.delegate) {
                if (this.delegate.sceneWillChange) {
                    this.delegate.sceneWillChange();
                }
            }

            if (this._scene) {
                this._scene.removeEventListener("materialUpdate", this);
                this._scene.removeEventListener("textureUpdate", this);
            }
        }
    },

    sceneDidChange: {
        value: function() {
            //FIXME: incoming scene should not be expected to be just non null
            if (this._scene) {
                this._sceneResourcesLoaded = false;
                this._scene.addEventListener("textureUpdate", this);
                this._scene.addEventListener("materialUpdate", this);
                this.applyScene();
                if (this.delegate) {
                    if (this.delegate.sceneDidChange) {
                        this.delegate.sceneDidChange();
                    }
                }
            }
        }
    },

    scene: {
        get: function() {
            return this._scene;
        },

        set: function(value) {
            if (value) {
                //FIXME:sort of a hack, only set the scene when ready
                if (value.isLoaded() === false) {
                    value.addOwnPropertyChangeListener("status", this);
                    return;
                }
            }

            if (this.scene != value) {
                this.sceneWillChange(value);
                this._scene = value;
                this.sceneDidChange();
            }
        }
    },

    // Montage
    constructor: {
        value: function View() {
            this.super();
        }
    },

    // Resources
    resourceAvailable: {
        value: function(resource) {
            //only issue draw once all requests finished
            if (this.allowsProgressiveSceneLoading == false) {
                var resourceManager = this.getResourceManager();
                if (resourceManager) {
                    if (resourceManager.hasPendingRequests() == false) {
                        this.needsDraw = true;
                    }
                } 
            }
        }
    },

    handleTextureUpdate: {
        value: function(evt) {
            var resourceManager = this.getResourceManager();
            if (resourceManager && this.sceneRenderer) {
                if (this.sceneRenderer.webGLRenderer) {
                    var webGLContext = this.sceneRenderer.webGLRenderer.webGLContext;
                    //trigger texture load/creation
                    var texture = resourceManager.getResource(evt.detail.value, this.sceneRenderer.webGLRenderer.textureDelegate, webGLContext);
                    if (texture) {
                        this.resourceAvailable();
                    }
                }
            }
        }
    },

    handleMaterialUpdate: {
        value: function(evt) {
            this.needsDraw = true;
        }
    },

    //
    __sceneTime: { value: 0, writable: true },

    _sceneTime: {
        set: function(value) {
            this.__sceneTime = value;
        },
        get: function() {
            return this.__sceneTime;
        }
    },

    _lastTime: { value: 0, writable: true },

    play: {
        value: function() {
            switch (this._state) {
                case this.PAUSE:
                case this.STOP:
                    this._lastTime = Date.now();
                    this._state = this.PLAY;
                    this.needsDraw = true;
                    break;
                default:
                    break;
            }

            this._state = this.PLAY;
        }
    },

    pause: {
        value: function() {
            this._state = this.PAUSE;
        }
    },

    _viewPointIndex: { value: 0, writable: true },

    automaticallyCycleThroughViewPoints: { value: true, writable: true },

    loops: { value: true, writable: true},

    stop: {
        value: function() {
            this._sceneTime = 0;
            this._state = this.STOP;
            this.needsDraw = true;
        }
    },

    STOP: { value: 0, writable: true },
    PLAY: { value: 1, writable: true },
    PAUSE: { value: 2, writable: true },

    _state: { value: 0, writable: true },

    _viewPoint: { value: null, writable: true },

    viewPointWillChange: {
        value:function(previousViewPoint, newViewPoint) {
                var interpolatingViewPoint = null;
                if (this.sceneRenderer) {
                    if (newViewPoint) {
                        if (this.scene) {
                            if (this.scene.glTFElement) {
                                var animationManager = this.scene.glTFElement.animationManager;
                                //we do not animate already animated cameras
                                var hasStaticViewPoint = animationManager.nodeHasAnimatedAncestor(newViewPoint.glTFElement) == false;
                                if (hasStaticViewPoint == false && previousViewPoint != null) {
                                    hasStaticViewPoint |= animationManager.nodeHasAnimatedAncestor(previousViewPoint.glTFElement) == false;
                                }
                                if (hasStaticViewPoint) {
                                    var orbitXY = this.orbitCamera == null ? null : [this.orbitCamera.orbitX, this.orbitCamera.orbitY];
                                    interpolatingViewPoint = {  "previous": previousViewPoint ? previousViewPoint.glTFElement : null,
                                                                "step":0,
                                                                "start" : Date.now(),
                                                                "duration": 1000,
                                                                "orbitXY" : orbitXY,
                                                                "orbitDistance" : this.orbitCamera ? this.orbitCamera.getDistance() : 0 };
                                }
                            }
                        }
                        this.interpolatingViewPoint = interpolatingViewPoint;
                    }
                }
            }
        
    },

    viewPointDidChange: {
        value:function() {
                this._cameraController.node = this.viewPoint;

                if (this.sceneRenderer) {
                    if (this._viewPoint) {
                        if (this.scene) {
                            if (this.scene.glTFElement) {
                                this.sceneRenderer.technique.rootPass.viewPoint = this._viewPoint ? this._viewPoint.glTFElement : null;
                                this._viewPointIndex = this._getViewPointIndex(this.viewPoint);
                                this.needsDraw = true;
                            }
                        }
                    }
                }
        }
    },

    viewPoint: {
        get: function() {
            return this._viewPoint;
        },
        set: function(value) {
            if (this._viewPoint != value) {
                var previousViewPoint = null;
                if (this._viewPoint && value) {
                    if (this._viewPoint.scene == value.scene) {
                        previousViewPoint = this._viewPoint;
                    }
                }

                this.viewPointWillChange(previousViewPoint, value);
                this._viewPoint = value;
                this._sceneTime = 0;
                if (value) {
                    if (this.scene && (this._viewPoint.scene == null)) {
                        this._viewPoint.scene = this.scene;
                    }
                }
                this.viewPointDidChange();
            }
        }
    },

    translateComposer: { value: null, writable: true },

    scaleFactor: { value: (window.devicePixelRatio || 1), writable: true},

    canvas: {
        get: function() {
            if (this.templateObjects) {
                return this.templateObjects.canvas;
            } 
            return null;
        }
    },

    _orbitCamera: { value: null, writable: true },

    orbitCamera: {
        get: function() {
            return this._orbitCamera;
        },
        set: function(value) {
            this._orbitCamera = value;
        }
    },

    _sceneRenderer: { value: null, writable: true },

    sceneRenderer: {
        get: function() {
            return this._sceneRenderer;
        },
        set: function(value) {
            if (value != this._sceneRenderer) {
                this._sceneRenderer = value;
            }
        }
    },

    handleStatusChange: {
        value: function(status, key, object) {
            if (status === "loaded") {
                this.scene = object;
                this.needsDraw = true;
            }
        }
    },

    //Test for https://github.com/KhronosGroup/glTF/issues/67
    /*
    loadMultipleScenesTest: {
        value: function() {
            var paths = [];
            paths.push( "model/parts/Part1.json" );
            paths.push( "model/parts/Part2.json" );
            paths.push( "model/parts/Part3.json" );

            var pathsIndex = 0;
            var mainScene = Object.create(glTFScene).init();
            var readerDelegate = {};
            readerDelegate.loadCompleted = function (scene) {
                mainScene.rootNode.children.push(scene.rootNode);
                pathsIndex++;
                if (paths.length === pathsIndex) {
                    this.needsDraw = true;
                    this.scene = mainScene;
                }
                //FIXME:HACK: loader should be passed as arg, also multiple observers should pluggable here so that the top level could just pick that size info. (for the progress)
            }.bind(this);

            paths.forEach( function(path) {
                var loader = Object.create(RuntimeTFLoader);
                loader.initWithPath(path);
                loader.delegate = readerDelegate;
                loader.load(null, null );
            }, this);
        }
    },
    */

    //scenePath is legacy and is kept just for compatibility for now
    scenePath: {
        set: function(value) {
            if (value) {
                var URLObject = URL.parse(value);
                if (!URLObject.scheme) {
                    var packages = Object.keys(require.packages);
                    //HACK: for demo, packages[0] is guaranted to be the entry point
                    value = URL.resolve(packages[0], value);
                }
            }

            if (this.scene) {
                if (value == this.scene.path) {
                    return;
                }
            }

            var scene = Montage.create(Scene).init();
            scene.addOwnPropertyChangeListener("status", this);
            scene.path = value;
        },

        get: function() {
            return this.scene ? this.scene.path : null;
        }
    },

    //FIXME: cache this in the scene
    _getViewPointIndex: {
        value: function(viewPoint) {
            var viewPoints = SceneHelper.getGLTFViewPoints(viewPoint.scene);

            for (var i = 0 ; i < viewPoints.length ; i++) {
                if (viewPoints[i].baseId === viewPoint.id)
                    return i;
            }
            return 0;
        }
    },

    applyScene: {
        value:function () {
            var m3dScene = this.scene;
            var scene = m3dScene.glTFElement;
            var self = this;
            if (this.sceneRenderer) {
                if (this.sceneRenderer.technique.rootPass) {
                    if (scene) {
                        var viewPoints= SceneHelper.getViewPoints(m3dScene);
                        var hasCamera = viewPoints.length > 0;
                        // arbitry set first coming camera as the view point
                        if (hasCamera) {
                            var shouldKeepViewPoint = false;
                            if (this.viewPoint) {
                                if (this.viewPoint.scene) {
                                    shouldKeepViewPoint = this.viewPoint.scenePath === m3dScene.scenePath;
                                }
                            }
                            if (shouldKeepViewPoint === false) {
                                this.viewPoint = viewPoints[0];
                            }
                        } else {
                            var center = null;

                            var sceneBBox =  scene.rootNode.getBoundingBox(true);
                            var bbox = Object.create(BBox).init(sceneBBox[0], sceneBBox[1]);
                            center = vec3.createFrom(0,0,(bbox.size[2]*bbox.computeScaleFactor())/2);
                            scene.rootNode.transform._updateDirtyFlag(false);

                            var glTFScene = this.scene.glTFElement;
                            var targettedNode = glTFScene.rootNode;
                            var sceneBBox =  glTFScene.rootNode.getBoundingBox(true);
                            var midPoint = [
                                (sceneBBox[0][0] + sceneBBox[1][0]) / 2,
                                (sceneBBox[0][1] + sceneBBox[1][1]) / 2,
                                (sceneBBox[0][2] + sceneBBox[1][2]) / 2];
                            var viewPoint = SceneHelper.createNodeIncludingCamera("__default_camera__", m3dScene);
                            viewPoint.glTFElement.cameras[0].projection.zfar = sceneBBox[1][1] * 2;
                            this.scene.glTFElement.rootNode.children.push(viewPoint.glTFElement);
                            var viewPortDistance = midPoint[2];

                            var eye = [midPoint[0], midPoint[1], midPoint[2]];
                            eye[2] += viewPortDistance + (sceneBBox[1][0] - sceneBBox[0][0]);

                            viewPoint.glTFElement.transform.translation = eye;

                            this.viewPoint = viewPoint;
                        }

                        this.sceneRenderer.scene = scene;
                    }

                    //right now, play by default
                    if (this.viewPoint) {
                        if (this.viewPoint.scene == null) {
                            this.viewPoint.scene = m3dScene;
                        }
                        if (this.sceneRenderer) {
                            this.interpolatingViewPoint = null;
                            this.viewPointDidChange();
                        }
                    }


                    if (this.allowsProgressiveSceneLoading === false) {
                        var renderPromise = this.scene.prepareToRender(this.sceneRenderer.webGLRenderer);
                        renderPromise.then(function () {
                            self.sceneRenderer.webGLRenderer.webGLContext.finish();
                            self._sceneResourcesLoaded = true;
                            self.needsDraw = true;

                        }, function (error) {
                        }, function (progress) {
                        });

                    } else {
                        this.needsDraw = true;
                    }
                }
            }
        }
    },

    getRelativePositionToCanvas: {
        value: function(event) {
            return dom.convertPointFromPageToNode(this.canvas, Point.create().init(event.pageX, event.pageY));
        }
    },

    _disableRendering: { value: false, writable: true },

    _contextAttributes : { value: null, writable: true },

    _shouldForceClear: { value: false, writable: true },

    enterDocument: {
        value: function(firstTime) {
            var simulateContextLoss = false;  //Very naive for now
            var self = this;

            if (simulateContextLoss) {
                this.canvas = WebGLDebugUtils.makeLostContextSimulatingCanvas(this.canvas);
            }

            var webGLOptions = {  premultipliedAlpha: false, antialias: true, preserveDrawingBuffer: false };
            var webGLContext =  this.canvas.getContext("experimental-webgl", webGLOptions) ||
                                this.canvas.getContext("webgl", webGLOptions);

            function throwOnGLError(err, funcName, args) {
                throw WebGLDebugUtils.glEnumToString(err) + " was caused by call to: " + funcName;
            };

            //webGLContext = WebGLDebugUtils.makeDebugContext(webGLContext, throwOnGLError);

            if (webGLContext == null) {
                console.log("Please check that your browser enables & supports WebGL");
                return
            }

            this._contextAttributes = webGLContext.getContextAttributes();
            var antialias = false;
            if (this._contextAttributes) {
                antialias = this._contextAttributes.antialias;
            }
            if (antialias == false) {
                console.log("WARNING: anti-aliasing is not supported/enabled")
            }

            //check from http://davidwalsh.name/detect-ipad
            if (navigator) {
                // For use within normal web clients
                var isiPad = navigator.userAgent.match(/iPad/i) != null;
                if (isiPad == false) {
                    // For use within iPad developer UIWebView
                    // Thanks to Andrew Hedges!
                    var ua = navigator.userAgent;
                    isiPad = /iPad/i.test(ua) || /iPhone OS 3_1_2/i.test(ua) || /iPhone OS 3_2_2/i.test(ua);
                }
                if (isiPad) {
                    this._shouldForceClear = true;
                }
            }

            var webGLRenderer = Object.create(WebGLRenderer).initWithWebGLContext(webGLContext);
            webGLContext.enable(webGLContext.DEPTH_TEST);
            var options = null;
            this.sceneRenderer = Object.create(SceneRenderer);
            this.sceneRenderer.init(webGLRenderer, options);

            var resourceManager = this.getResourceManager();
            if (!resourceManager.isObserving()) {
                resourceManager.observers.push(this);
                resourceManager.startObserving();
            }

            if (this.scene)
                this.applyScene();

            this.canvas.addEventListener("webglcontextlost", function(event) {
                console.log("context was lost");
                event.preventDefault();
                self.getResourceManager.stopObserving();
                self.sceneRenderer.webGLRenderer.resourceManager.reset();
                self.needsDraw = false;
                self._disableRendering = true;
            }, false);

            this.canvas.addEventListener("webglcontextrestored", function(event) {
                console.log("context was restored");
                event.preventDefault();
                webGLContext.enable(webGLContext.DEPTH_TEST);
                self.needsDraw = true;
                self._disableRendering = false;
            }, false);

            if (simulateContextLoss) {
                setTimeout(function() {
                    self.canvas.loseContext();
                }, 5000);
            }

            //setup gradient
            var self = this;
            var techniquePromise = BuiltInAssets.assetWithName("gradient");
            techniquePromise.then(function (glTFScene_) {
                var scene = Montage.create(Scene).init(glTFScene_);
                self.gradientRenderer = Object.create(SceneRenderer);
                self.gradientRenderer.init(webGLRenderer, null);
                self.gradientRenderer.scene = scene.glTFElement;
                var viewPoints = SceneHelper.getViewPoints(scene);
                if (viewPoints) {
                    if (viewPoints.length) {
                        self.gradientRenderer.technique.rootPass.viewPoint = viewPoints[0].glTFElement;
                    }
                }
                self.needsDraw = true;
            }, function (error) {
            }, function (progress) {
            });

            this.needsDraw = true;

            // TODO the camera does its own listening but doesn't know about our draw system
            // I'm minimizing impact to the dependencies as we get this all working so the listeners
            // here really don't do much other than trigger drawing. They listen on capture
            // to handle the event before the camera stopsPropagation (for whatever reason it does that)
            this.canvas.addEventListener('touchstart', this.start.bind(this), true);
            document.addEventListener('touchend', this.end.bind(this), true);
            document.addEventListener('touchcancel', this.end.bind(this), true);
            document.addEventListener('touchmove', this.move.bind(this), true);
            document.addEventListener('gesturechange', this, true);
            this.canvas.addEventListener('mousedown', this.start.bind(this), true);
            document.addEventListener('mouseup', this.end.bind(this), true);
            document.addEventListener('mousemove', this.move.bind(this), true);
            document.addEventListener('mousewheel', this, true);
        }
    },

    captureMousewheel: {
        value: function() {
            this.needsDraw = true;
        }
    },

    captureGesturechange: {
        value: function() {
            this.needsDraw = true;
        }
    },

    move:{
        value: function (event) {
            //no drag at the moment
            this._mousePosition = null;
        }
    },

    start: {
        value: function (event) {
            event.preventDefault();
            this._consideringPointerForPicking = true;
            var position = this.getRelativePositionToCanvas(event);
            this._mousePosition = [position.x * this.scaleFactor,  this.height - (position.y * this.scaleFactor)];

            if (this._state == this.PLAY) {
                this.pause();
            }
        }
    },

    end:{
        value: function (event) {

            if (this._consideringPointerForPicking && event.target === this.canvas) {
                event.preventDefault();
            }

            if (this._state == this.PAUSE) {
                if (this.scene && this.viewPoint) {
                    if (this.scene.glTFElement) {
                        if (this.scene.glTFElement.animationManager) {
                            var animationManager = this.scene.glTFElement.animationManager;
                            if (animationManager.nodeHasAnimatedAncestor(this.viewPoint.glTFElement)) {
                                this.play();
                            }
                        }
                    }
                }
            }

            this._consideringPointerForPicking = false;
            this._mousePosition = null;
        }
    },

    /* returns an array of test results */
    hitTest: {
        value: function(position, options) {
            if (this.sceneRenderer) {
                if ((this.sceneRenderer.technique.rootPass) && (this.canvas)) {
                    var viewport = [0, 0, parseInt(this.canvas.getAttribute("width")), parseInt(this.canvas.getAttribute("height"))];
                    return this.sceneRenderer.technique.rootPass.hitTest(position, viewport, options);
                }
            }
            return null;
        }
    },

    getWebGLRenderer: {
        value: function() {
            return this.sceneRenderer ? this.sceneRenderer.webGLRenderer : null;
        }
    },

    getWebGLContext: {
        value: function() {
            var renderer = this.getWebGLRenderer();
            return renderer ? renderer.webGLContext : null;
        }
    },

    getResourceManager: {
        value: function() {
            var renderer = this.getWebGLRenderer();
            return renderer ? renderer.resourceManager : null;
        }
    },

    _consideringPointerForPicking: { writable: true, value: false },

    _mousePosition: { writable: true, value : null },

    _floorTextureLoaded : { writable: true, value: false },

    _showGradient: {
        value: false, writable: true
    },

    _showReflection: {
        value: false, writable: true
    },

    _showBBOX: {
        value: false, writable: true
    },

    showBBOX: {
        get: function() {
            return this._showBBOX;
        },
        set: function(flag) {
            if (flag != this._showBBOX) {
                this._showBBOX = flag;
                this.needsDraw = true;
            }
        }
    },

    showGradient: {
        get: function() {
            return this._showGradient;
        },
        set: function(flag) {
            if (flag != this._showGradient) {
                this._showGradient = flag;
                this.needsDraw = true;
            }
        }
    },

    showReflection: {
        get: function() {
            return this._showReflection;
        },
        set: function(flag) {
            this._showReflection = flag;
            this.needsDraw = true;
        }
    },

    selectedNode: { value: null, writable:true },

    handleSelectedNode: {
        value: function(nodeID) {
        }
    },

    displayAllBBOX: {
        value: function(cameraMatrix) {
            if (!this.scene)
                return;
            if (this.scene.glTFElement) {
                var ctx = mat4.identity();
                var node = this.scene.glTFElement.rootNode;
                var self = this;

                node.apply( function(node, parent, parentTransform) {
                    var modelMatrix = mat4.create();
                    mat4.multiply( parentTransform, node.transform.matrix, modelMatrix);
                    if (node.boundingBox) {
                        var viewPoint = self.viewPoint;
                        var projectionMatrix = viewPoint.glTFElement.cameras[0].projection.matrix;
                        self.getWebGLRenderer().drawBBOX(node.boundingBox, cameraMatrix, modelMatrix, projectionMatrix);
                    }
                    return modelMatrix;
                }, true, ctx);
            }
        }
    },

    _width: {
        value: null
    },

    width: {
        get: function() {
            if (this._width == null) {
                var computedStyle = window.getComputedStyle(this.element, null);
                return parseInt(computedStyle["width"]) * this.scaleFactor;
            }
            return this._width;
        },
        set: function(value) {
            if (value != this._width) {
                this._width = value * this.scaleFactor;
                this.needsDraw = true;
            }
        }
    },

    _height: {
        value: null
    },

    height: {
        get: function() {
            if (this._height == null) {
                var computedStyle = window.getComputedStyle(this.element, null);
                return parseInt(computedStyle["height"]) * this.scaleFactor;
            }
            return this._height;
        },
        set: function(value) {
            if (value != this._height) {
                this._height = value * this.scaleFactor;
                this.needsDraw = true;
            }
        }
    },

    interpolatingViewPoint: {
        value: null, writable:true
    },

    draw: {
        value: function() {
            //bail out if we don't allow to have resources progressively loaded
            //we should show a loading progress here
            if ((this.allowsProgressiveSceneLoading === false) && (this._sceneResourcesLoaded === false)) {
                return;
            }

            //Update canvas when size changed
            var width, height, webGLContext = this.getWebGLContext();
            if (webGLContext == null || this._disableRendering)
                return;

            //WebGL does it for us with preserveDrawBuffer = false
            if (this._shouldForceClear || (this._contextAttributes.preserveDrawingBuffer == null) || (this._contextAttributes.preserveDrawingBuffer == true)) {
                webGLContext.clearColor(0,0,0,0.);
                webGLContext.clear(webGLContext.DEPTH_BUFFER_BIT | webGLContext.COLOR_BUFFER_BIT);
            }

            width = this.width;
            height = this.height;

            //as indicated here: http://www.khronos.org/webgl/wiki/HandlingHighDPI
            //set draw buffer and canvas size
            if ((width != this.canvas.width) || (height != this.canvas.height)) {
                this.canvas.style.width = (width / this.scaleFactor) + "px";
                this.canvas.style.height = (height / this.scaleFactor) + "px";
                this.canvas.width = width;
                this.canvas.height = height;
                webGLContext.viewport(0, 0, width, height);
            }

            if (this.viewPoint) {
                if (this.viewPoint.glTFElement)
                    this.viewPoint.glTFElement.cameras[0].projection.aspectRatio =  width / height;
            }

            if (this._scene == null || this.viewPoint == null || this._disableRendering)
                return;
            var viewPoint = this.viewPoint;
            var self = this;
            var time = Date.now();
            if (this.interpolatingViewPoint) {
                if ((time - this.interpolatingViewPoint.start) < this.interpolatingViewPoint.duration) {
                    if (this.orbitCamera) {
                        this.orbitCamera.ignoreEvents = true;
                        var step = (time - this.interpolatingViewPoint.start) /(this.interpolatingViewPoint.duration);
                        step = Utilities.easeOut(Math.min(step,1));
                        var destination = [0, 0];
                        Utilities.interpolateVec(this.interpolatingViewPoint.orbitXY, [0, 0], step, destination);
                        this.orbitCamera.orbitX = destination[0];
                        this.orbitCamera.orbitY = destination[1];
                        var orbitDistance = this.interpolatingViewPoint.orbitDistance;
                        this.orbitCamera.setDistance(orbitDistance + ((0 - orbitDistance) * step));
                        this.orbitCamera._dirty = true;
                    }
                } else {
                    if (this.orbitCamera) {
                        this.orbitCamera.ignoreEvents = false;
                        this.orbitCamera.orbitX = 0;
                        this.orbitCamera.orbitY = 0;
                        this.orbitCamera.setDistance(0);
                        this.interpolatingViewPoint = null;
                    }
                }
                this.needsDraw = true;
            }

            if (this.sceneRenderer && this.scene) {
                var endTime = this.scene.glTFElement.endTime;

                var animationManager = this.scene.glTFElement.animationManager;
                if (this._state == this.PLAY && animationManager) {
                    this._sceneTime += time - this._lastTime;

                    if (endTime !== -1) {
                        if (this._sceneTime / 1000. > endTime) {
                            if (this.automaticallyCycleThroughViewPoints == true) {
                                var viewPointIndex = this._viewPointIndex;
                                var viewPoints = SceneHelper.getViewPoints(this.scene);
                                if (viewPoints.length > 0) {
                                    var nextViewPoint;
                                    var checkIdx = 0;
                                    do {
                                        this._sceneTime = 0;
                                        checkIdx++;
                                        viewPointIndex = ++viewPointIndex % viewPoints.length;
                                        nextViewPoint = viewPoints[viewPointIndex];
                                    } while ((checkIdx < viewPoints.length) && (animationManager.nodeHasAnimatedAncestor(nextViewPoint.glTFElement) == false));
                                    this.viewPoint = nextViewPoint;
                                }
                            }
                            if (this.loops) {
                                this._sceneTime = endTime == 0 ? 0 : this._sceneTime % endTime;
                           } else {
                                this.stop();
                            }
                        }
                    }

                    this.scene.glTFElement.animationManager.updateTargetsAtTime(this._sceneTime, this.sceneRenderer.webGLRenderer.resourceManager);
                }
            }
            this._lastTime = time;
            //----

            var renderer;

            if (this._state == this.PLAY)
               this.needsDraw = true;

            if (this.scene) {
                renderer = this.sceneRenderer.webGLRenderer;
                if (webGLContext) {
                    if (this.__renderOptions == null) {
                        this.__renderOptions = {};
                    }

                    this.__renderOptions.viewPointModifierMatrix = this.viewPointModifierMatrix;
                    this.__renderOptions.interpolatingViewPoint = this.interpolatingViewPoint;

                    //FIXME: on the iPad with private function to enable webGL there was an issue with depthMask (need to re-check if that got fixed)
                    var allowsReflection = this.showReflection;
                    if(allowsReflection) {
                        /* ------------------------------------------------------------------------------------------------------------
                         Draw reflected scene
                        ------------------------------------------------------------------------------------------------------------ */
                        webGLContext.depthFunc(webGLContext.LESS);
                        webGLContext.enable(webGLContext.DEPTH_TEST);
                        webGLContext.frontFace(webGLContext.CW);
                        webGLContext.depthMask(true);
                        //should retrieve by node
                        var rootNode = this.scene.glTFElement.rootNode;
                        var nodeBBOX = rootNode.getBoundingBox(true);
                        var savedTr = mat4.create(rootNode.transform.matrix);
                        var scaleMatrix = mat4.scale(mat4.identity(), [1, 1, -1]);
                        mat4.multiply(scaleMatrix, rootNode.transform.matrix) ;
                        rootNode.transform.matrix = scaleMatrix;
                        var invVNodeBBOX = rootNode.getBoundingBox(true);
                        var mirrorMatrix = mat4.identity();
                        var translationMatrix = mat4.translate(mat4.identity(), [0, 0,  (nodeBBOX[0][2] - invVNodeBBOX[1][2])]);
                        mat4.multiply(mirrorMatrix, translationMatrix);
                        mat4.multiply(mirrorMatrix, scaleMatrix);
                        rootNode.transform.matrix = mirrorMatrix;
                        this.sceneRenderer.render(time, this.__renderOptions);
                        rootNode.transform.matrix = savedTr;
                        webGLContext.frontFace(webGLContext.CCW);
                    }

                    if (this.showGradient || allowsReflection) {
                        //FIXME:For now, just allow reflection when using default camera
                        //if (this.viewPoint.id === "__default_camera") {
                            if (this.gradientRenderer) {
                                webGLContext.enable(webGLContext.BLEND);
                                webGLContext.disable(webGLContext.DEPTH_TEST);
                                webGLContext.disable(webGLContext.CULL_FACE);
                                webGLContext.depthMask(false);
                                this.gradientRenderer.render(time, this.__renderOptions);
                                webGLContext.depthMask(true);
                                webGLContext.enable(webGLContext.DEPTH_TEST);
                                webGLContext.enable(webGLContext.CULL_FACE);
                                webGLContext.disable(webGLContext.BLEND);
                            }
                        //}
                    }

                    /* disable picking
                    if (this._mousePosition) {
                        this.__renderOptions.picking = true;
                        this.__renderOptions.coords = this._mousePosition;
                        this.__renderOptions.delegate = this;

                        this.sceneRenderer.render(time, this.__renderOptions);
                    }
                    */
                    this.__renderOptions.picking = false;
                    this.__renderOptions.coords = null;
                    this.__renderOptions.delegate = null;

                    this.sceneRenderer.render(time, this.__renderOptions);

                    //FIXME: ...create an API to retrive the actual viewPoint matrix...
                    if (this.showBBOX)
                        this.displayAllBBOX(this.sceneRenderer.technique.rootPass.scenePassRenderer._viewPointMatrix);

                    webGLContext.flush();

                    if (this._firstFrameDidRender === false) {
                        this._firstFrameDidRender = true;
                        this.dispatchEventNamed("firstFrameDidRender", true, false, this);
                    }
                    /*
                    var error = webGLContext.getError();
                    if (error != webGLContext.NO_ERROR) {
                        console.log("gl error"+webGLContext.getError());
                    }
                    */
                }
            }
        }
    },

    willDraw: {
        value: function() {
        }
    },

    _cameraController: { value: null, writable: true },

    templateDidLoad: {
        value: function() {
            var self = this;
            window.addEventListener("resize", this, true);

            var parent = this.parentComponent;
            var animationTimeout = null;
            var composer = TranslateComposer.create();
            composer.animateMomentum = true;
            composer.hasMomentum = true;
            composer.allowFloats = true;
            composer.pointerSpeedMultiplier = 0.15;
            this.addComposerForElement(composer, this.canvas);

            this._cameraController = Montage.create(CameraController);

            composer.addEventListener("translate", function(event) {
                self._cameraController.translate(event);
                self.needsDraw = true;
            });

            composer.addEventListener('translateStart', function (event) {
                self._cameraController.beginTranslate(event);
            }, false);

            composer.addEventListener('translateEnd', function (event) {
                self._cameraController.endTranslate(event);
            }, false);

            this.translateComposer = composer;
        }
    }
});

