'use strict';

let angular = require('angular');
require('../../loadBalancer.less');

module.exports = angular.module('spinnaker.loadBalancer.openstack.create.controller', [
  require('angular-ui-router'),
  require('../../../../core/loadBalancer/loadBalancer.write.service.js'),
  require('../../../../core/loadBalancer/loadBalancer.read.service.js'),
  require('../../../../core/account/account.service.js'),
  require('../../../../core/modal/wizard/v2modalWizard.service.js'),
  require('../../../../core/task/monitor/taskMonitorService.js'),
  require('../../../../core/search/search.service.js'),
  require('../../transformer.js'),
  require('../../../region/regionSelectField.directive.js'),
  require('../../../subnet/subnetSelectField.directive.js'),
  require('../../../network/networkSelectField.directive.js'),
  require('../../../common/isolateForm.directive.js'),
])
  .controller('openstackUpsertLoadBalancerController', function($scope, $uibModalInstance, $state,
                                                                 application, loadBalancer, isNew, loadBalancerReader,
                                                                 accountService, openstackLoadBalancerTransformer,
                                                                 _, loadBalancerWriter, taskMonitorService) {
    var ctrl = this;
    $scope.isNew = isNew;

    $scope.pages = {
      location: require('./location.html'),
      interface: require('./interface.html'),
      destinations: require('./destinations.html'),
      healthCheck: require('./healthCheck.html'),
    };

    $scope.state = {
      accountsLoaded: false,
      loadBalancerNamesLoaded: false,
      submitting: false
    };

    $scope.subnetFilter = {};

    $scope.protocols = ['HTTP', 'HTTPS'];
    $scope.maxPort = 65535;
    $scope.methods = [
      { label: 'Round Robin', value: 'ROUND_ROBIN' },
      { label: 'Least Connections', value: 'LEAST_CONNECTIONS' },
      { label: 'Source IP', value: 'SOURCE_IP' }
    ];

    // initialize controller
    if (loadBalancer) {
      $scope.loadBalancer = openstackLoadBalancerTransformer.convertLoadBalancerForEditing(loadBalancer);
    } else {
      $scope.loadBalancer = openstackLoadBalancerTransformer.constructNewLoadBalancerTemplate();
      initializeLoadBalancerNames();
    }

    finishInitialization();

    function onApplicationRefresh() {
      // If the user has already closed the modal, do not navigate to the new details view
      if ($scope.$$destroyed) {
        return;
      }
      $uibModalInstance.close();
      var newStateParams = {
        provider: 'openstack',
        name: $scope.loadBalancer.name,
        accountId: $scope.loadBalancer.account,
        region: $scope.loadBalancer.region,
      };
      if (!$state.includes('**.loadBalancerDetails')) {
        $state.go('.loadBalancerDetails', newStateParams);
      } else {
        $state.go('^.loadBalancerDetails', newStateParams);
      }
    }

    function onTaskComplete() {
      application.loadBalancers.refresh();
      application.loadBalancers.onNextRefresh($scope, onApplicationRefresh);
    }

    $scope.taskMonitor = taskMonitorService.buildTaskMonitor({
      application: application,
      title: (isNew ? 'Creating ' : 'Updating ') + 'your load balancer',
      modalInstance: $uibModalInstance,
      onTaskComplete: onTaskComplete,
    });

    var allLoadBalancerNames = {};

    function finishInitialization() {
      accountService.listAccounts('openstack').then(function (accounts) {
        $scope.accounts = accounts;
        $scope.state.accountsLoaded = true;

        var accountNames = _.pluck($scope.accounts, 'name');
        if (accountNames.length && accountNames.indexOf($scope.loadBalancer.account) === -1) {
          $scope.loadBalancer.account = accountNames[0];
        }

        ctrl.accountUpdated();
      });
    }

    function initializeLoadBalancerNames() {
      loadBalancerReader.listLoadBalancers('openstack').then(function (loadBalancers) {
        loadBalancers.forEach((loadBalancer) => {
          let account = loadBalancer.account;
          if (!allLoadBalancerNames[account]) {
            allLoadBalancerNames[account] = {};
          }
          let region = loadBalancer.region;
          if (!allLoadBalancerNames[account][region]) {
            allLoadBalancerNames[account][region] = [];
          }
          allLoadBalancerNames[account][region].push(loadBalancer.name);
        });

        $scope.state.loadBalancerNamesLoaded = true;
        updateLoadBalancerNames();
      });
    }

    function updateLoadBalancerNames() {
      $scope.existingLoadBalancerNames = _.flatten(_.map(allLoadBalancerNames[$scope.loadBalancer.account || ''] || []));
    }

    // Controller API
    this.updateName = function() {
      if (!isNew) {
        return;
      }

      var loadBalancer = $scope.loadBalancer;
      var loadBalancerName = [application.name, (loadBalancer.stack || ''), (loadBalancer.detail || '')].join('-');
      loadBalancer.name = _.trimRight(loadBalancerName, '-');
    };

    this.accountUpdated = function() {
      ctrl.updateName();
      updateLoadBalancerNames();
    };

    this.onRegionChanged = function(regionId) {
      $scope.loadBalancer.region = regionId;

      //updating the filter triggers a refresh of the subnets
      $scope.subnetFilter = {type: 'openstack', account: $scope.loadBalancer.account, region: $scope.loadBalancer.region};
    };

    this.onDistributionChanged = function(distribution) {
      $scope.loadBalancer.method = distribution;
    };

    this.newStatusCode = 200;
    this.addStatusCode = function() {
      var newCode = parseInt(this.newStatusCode);
      if ($scope.loadBalancer.healthMonitor.expectedHttpStatusCodes.indexOf(newCode) === -1) {
        $scope.loadBalancer.healthMonitor.expectedHttpStatusCodes.push(newCode);
        $scope.loadBalancer.healthMonitor.expectedHttpStatusCodes.sort();
      }
    };

    this.removeStatusCode = function(code) {
      $scope.loadBalancer.healthMonitor.expectedHttpStatusCodes = $scope.loadBalancer.healthMonitor.expectedHttpStatusCodes.filter(function(c) {
        return c !== code;
      });
    };

    this.prependForwardSlash = (text) => {
      return text && text.indexOf('/') !== 0 ? `/${text}` : text;
    };

    this.submit = function () {
      var descriptor = isNew ? 'Create' : 'Update';

      this.updateName();
      $scope.taskMonitor.submit(
        function() {
          let params = {
            cloudProvider: 'openstack',
            account: $scope.loadBalancer.accountId || $scope.loadBalancer.account,
            accountId: $scope.loadBalancer.accountId
          };
          return loadBalancerWriter.upsertLoadBalancer(_.omit($scope.loadBalancer, 'accountId'), application, descriptor, params);
        }
      );
    };

    this.cancel = function () {
      $uibModalInstance.dismiss();
    };
  });
