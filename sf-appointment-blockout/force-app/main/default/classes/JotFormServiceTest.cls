@isTest
private class JotFormServiceTest {

    private class QuestionsCalloutMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(200);
            res.setHeader('Content-Type', 'application/json');
            res.setBody('{"responseCode":200,"message":"success","content":{' +
                '"1":{"type":"control_head","text":"Header","qid":"1","name":"heading"},' +
                '"72":{"type":"control_appointment","text":"Schedule Appointment","qid":"72","name":"appointment72",' +
                    '"blockoutDates":"[{\\"startDate\\":\\"2026-12-25\\",\\"endDate\\":\\"2026-12-25\\"}]"},' +
                '"5":{"type":"control_textbox","text":"Name","qid":"5","name":"name"}' +
            '}}');
            return res;
        }
    }

    private class QuestionDetailMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(200);
            res.setHeader('Content-Type', 'application/json');
            res.setBody('{"responseCode":200,"message":"success","content":{' +
                '"type":"control_appointment","text":"Schedule Appointment","qid":"72","name":"appointment72",' +
                '"blockoutDates":"[{\\"startDate\\":\\"2026-12-25\\",\\"endDate\\":\\"2026-12-25\\"}]"' +
            '}}');
            return res;
        }
    }

    private class UpdateCalloutMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(200);
            res.setHeader('Content-Type', 'application/json');
            res.setBody('{"responseCode":200,"message":"success","content":{}}');
            return res;
        }
    }

    private class ErrorCalloutMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(401);
            res.setHeader('Content-Type', 'application/json');
            res.setBody('{"responseCode":401,"message":"Invalid API key"}');
            return res;
        }
    }

    @isTest
    static void testGetAppointmentQuestions() {
        Test.setMock(HttpCalloutMock.class, new QuestionsCalloutMock());
        Test.startTest();
        List<JotFormService.AppointmentQuestion> results =
            JotFormService.getAppointmentQuestions('123456789');
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Should find one appointment question');
        System.assertEquals('72', results[0].qid);
        System.assertEquals('Schedule Appointment', results[0].text);
        System.assertEquals(1, results[0].blockoutDates.size());
        System.assertEquals('2026-12-25', results[0].blockoutDates[0].startDate);
    }

    @isTest
    static void testGetBlockoutDates() {
        Test.setMock(HttpCalloutMock.class, new QuestionDetailMock());
        Test.startTest();
        List<JotFormService.BlockoutDate> dates =
            JotFormService.getBlockoutDates('123456789', '72');
        Test.stopTest();

        System.assertEquals(1, dates.size());
        System.assertEquals('2026-12-25', dates[0].startDate);
        System.assertEquals('2026-12-25', dates[0].endDate);
    }

    @isTest
    static void testUpdateBlockoutDates() {
        Test.setMock(HttpCalloutMock.class, new UpdateCalloutMock());
        Test.startTest();
        List<JotFormService.BlockoutDate> dates = new List<JotFormService.BlockoutDate>{
            new JotFormService.BlockoutDate('2026-12-25', '2026-12-25'),
            new JotFormService.BlockoutDate('2026-12-31', '2027-01-01')
        };
        JotFormService.updateBlockoutDates('123456789', '72', dates);
        Test.stopTest();
    }

    @isTest
    static void testApiError() {
        Test.setMock(HttpCalloutMock.class, new ErrorCalloutMock());
        Test.startTest();
        try {
            JotFormService.getAppointmentQuestions('123456789');
            System.assert(false, 'Should have thrown');
        } catch (JotFormService.JotFormException e) {
            System.assertEquals('Invalid API key', e.getMessage());
        }
        Test.stopTest();
    }

    @isTest
    static void testGetAppointmentsInvocable() {
        Test.setMock(HttpCalloutMock.class, new QuestionsCalloutMock());
        JotFormBlockoutAction.GetAppointmentsRequest req = new JotFormBlockoutAction.GetAppointmentsRequest();
        req.formId = '123456789';
        Test.startTest();
        List<JotFormBlockoutAction.GetAppointmentsResult> results =
            JotFormBlockoutAction.getAppointmentQuestions(new List<JotFormBlockoutAction.GetAppointmentsRequest>{ req });
        Test.stopTest();

        System.assertEquals(true, results[0].success);
        System.assertNotEquals(null, results[0].appointmentsJson);
    }

    @isTest
    static void testGetAppointmentsInvocableError() {
        Test.setMock(HttpCalloutMock.class, new ErrorCalloutMock());
        JotFormBlockoutAction.GetAppointmentsRequest req = new JotFormBlockoutAction.GetAppointmentsRequest();
        req.formId = '123456789';
        Test.startTest();
        List<JotFormBlockoutAction.GetAppointmentsResult> results =
            JotFormBlockoutAction.getAppointmentQuestions(new List<JotFormBlockoutAction.GetAppointmentsRequest>{ req });
        Test.stopTest();

        System.assertEquals(false, results[0].success);
        System.assertEquals('Invalid API key', results[0].errorMessage);
    }

    @isTest
    static void testUpdateBlockoutInvocable() {
        Test.setMock(HttpCalloutMock.class, new UpdateCalloutMock());
        JotFormUpdateBlockoutAction.UpdateBlockoutRequest req = new JotFormUpdateBlockoutAction.UpdateBlockoutRequest();
        req.formId = '123456789';
        req.questionId = '72';
        req.blockoutDatesJson = '[{"startDate":"2026-12-25","endDate":"2026-12-25"}]';
        Test.startTest();
        List<JotFormUpdateBlockoutAction.UpdateBlockoutResult> results =
            JotFormUpdateBlockoutAction.updateBlockoutDates(
                new List<JotFormUpdateBlockoutAction.UpdateBlockoutRequest>{ req }
            );
        Test.stopTest();

        System.assertEquals(true, results[0].success);
    }

    @isTest
    static void testEmptyBlockoutDates() {
        Test.setMock(HttpCalloutMock.class, new UpdateCalloutMock());
        JotFormUpdateBlockoutAction.UpdateBlockoutRequest req = new JotFormUpdateBlockoutAction.UpdateBlockoutRequest();
        req.formId = '123456789';
        req.questionId = '72';
        req.blockoutDatesJson = '[]';
        Test.startTest();
        List<JotFormUpdateBlockoutAction.UpdateBlockoutResult> results =
            JotFormUpdateBlockoutAction.updateBlockoutDates(
                new List<JotFormUpdateBlockoutAction.UpdateBlockoutRequest>{ req }
            );
        Test.stopTest();

        System.assertEquals(true, results[0].success);
    }
}
